import * as vscode from "vscode";
import Current from "./Current";
import { handleFormatError } from "./UserInteraction";
import { existsSync } from "fs";
import { resolve } from "path";
import { execShellSync } from "./execShell";
import { request } from "http";
import { start } from "repl";

const wholeDocumentRange = new vscode.Range(
  0,
  0,
  Number.MAX_SAFE_INTEGER,
  Number.MAX_SAFE_INTEGER,
);

function userDefinedFormatOptionsForDocument(document: vscode.TextDocument): {
  options: string[];
  hasConfig: boolean;
} {
  const formatOptions = Current.config.formatOptions();
  if (formatOptions.indexOf("--config") != -1)
    return { options: formatOptions, hasConfig: true };
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const rootPath =
    (workspaceFolder && workspaceFolder.uri.fsPath) ||
    vscode.workspace.rootPath ||
    "./";
  const searchPaths = Current.config
    .formatConfigSearchPaths()
    .map((current) => resolve(rootPath, current));
  const existingConfig = searchPaths.find(existsSync);
  const options =
    existingConfig != null
      ? ["--config", existingConfig, ...formatOptions]
      : formatOptions;
  return { options, hasConfig: existingConfig != null };
}

const randomLineFormatterId = "Some_Random_Prefix_To_Formatt_sfsdgfgdfgdsdf"

function getStartLine(document: vscode.TextDocument, position: vscode.Position, isInMiddle: boolean = true) {
  let stack: string[] = []
  for (let lineInd = position.line - (isInMiddle ? 1 : 0); lineInd >= 0; --lineInd) {
    const line = document.lineAt(lineInd).text;
    for (let charIndx = line.length - 1; charIndx >= 0; charIndx--) { 
      if (line[charIndx] == '{') {
        if (stack.length == 0 && isInMiddle == true) {
          return new vscode.Position(lineInd, charIndx);
        } else {
          stack.pop();
          if (stack.length == 0 && isInMiddle == false) { 
            return new vscode.Position(lineInd, charIndx);
          }
        }
      } else if (line[charIndx] == '}') { 
        stack.push("}");
      }
    }
  }
  return new vscode.Position(0, 0);
}

function getIndentLine(document: vscode.TextDocument, range?: vscode.Range) {
  const startLine = getStartLine(document, range?.start || wholeDocumentRange.start)
  
  // found start of indent
  // parse the indent prefix
  let indent = document.getText(
    new vscode.Range(
      new vscode.Position(startLine.line, 0),
      new vscode.Position((range?.start.line || 1), 0)
    )
  )
     
  if (indent === "") { 
    return ""
  }
  return indent + "\n" + randomLineFormatterId
}

function getIndexOfCut(line: string) { 
  for (let i = line.length - 1; i >= 0; --i) {
    if (line[i].trim() == "") {
      if (line[i] == "\n") {
        return i;
      }
    } else { 
      return i + 1;
    }
  }
}

function format(request: {
  document: vscode.TextDocument;
  parameters?: string[];
  range?: vscode.Range;
  formatting: vscode.FormattingOptions;
}): vscode.TextEdit[] {
  try {
    const swiftFormatPath = Current.config.swiftFormatPath(request.document);
    if (swiftFormatPath == null) {
      return [];
    }
    const rangeFromBeginingOfLine = new vscode.Range(
      new vscode.Position(request.range?.start.line || 0, 0),
      request.range?.end || wholeDocumentRange.end
    )

    const indentPrefix = getIndentLine(request.document, rangeFromBeginingOfLine)
    const input = indentPrefix + "\n" + request.document.getText(rangeFromBeginingOfLine) + " " + randomLineFormatterId;
    console.log(input)
    if (input.trim() === "") return [];
    const userDefinedParams = userDefinedFormatOptionsForDocument(
      request.document,
    );
    if (!userDefinedParams.hasConfig && Current.config.onlyEnableWithConfig()) {
      return [];
    }
    const formattingParameters =
      userDefinedParams.options.indexOf("--indent") !== -1
        ? []
        : [
            "--indent",
            request.formatting.insertSpaces
              ? `${request.formatting.tabSize}`
              : "tabs",
          ];

    // Make the path explicitly absolute when on Windows. If we don't do this,
    // SwiftFormat will interpret C:\ as relative and put it at the end of
    // the PWD.
    let fileName = request.document.fileName;
    if (process.platform === "win32") {
      fileName = "/" + fileName;
    }

    let newContents = execShellSync(
      swiftFormatPath[0],
      [
        ...swiftFormatPath.slice(1),
        "stdin",
        "--stdinpath",
        fileName,
        ...userDefinedParams.options,
        ...(request.parameters || []),
        ...formattingParameters,
      ],
      {
        encoding: "utf8",
        input,
      },
    );
    const indexOfNextLine = newContents.indexOf(randomLineFormatterId) + randomLineFormatterId.length
    if (newContents[indexOfNextLine] == '\n') {
      newContents = newContents.substring(indexOfNextLine + 1)
    } else {
      newContents = newContents.substring(indexOfNextLine)
    }
    newContents = newContents.substring(0, newContents.length - randomLineFormatterId.length);
    newContents = newContents.substring(0, getIndexOfCut(newContents));

    return newContents !== request.document.getText(rangeFromBeginingOfLine)
      ? [
          vscode.TextEdit.replace(
            request.document.validateRange(rangeFromBeginingOfLine || wholeDocumentRange),
            newContents,
          ),
        ]
      : [];
  } catch (error) {
    handleFormatError(error, request.document);
    return [];
  }
}

export class SwiftFormatEditProvider
  implements
    vscode.DocumentRangeFormattingEditProvider,
    vscode.DocumentFormattingEditProvider,
    vscode.OnTypeFormattingEditProvider
{
  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    formatting: vscode.FormattingOptions,
  ) {
    return format({
      document,
      parameters: ["--fragment", "true"],
      range,
      formatting,
    });
  }
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    formatting: vscode.FormattingOptions,
  ) {
    return format({ document, formatting });
  }
  provideOnTypeFormattingEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    ch: string,
    formatting: vscode.FormattingOptions,
  ) {
    // Don't format if user has inserted an empty line
    let startLine = position.line;
    let endLine = position.line;
    if (ch == "\n") {
      startLine -= 1;
      if (position.line >= 0 && document.lineAt(startLine).text.trim() === "") {
        return [];
      }
      if (document.lineAt(position.line).text.trim() === "") {
        endLine--;
      }
      if (startLine > endLine) {
        return [];
      }
    } else if (ch == '}') { 
      startLine = getStartLine(document, position, false).line; 
    }

    const range = new vscode.Range(
      new vscode.Position(startLine, 0), 
      new vscode.Position(endLine, Number.MAX_SAFE_INTEGER)
    )
    return format({
      document,
      parameters: ["--fragment", "true"],
      range,
      formatting
    });
  }
}
