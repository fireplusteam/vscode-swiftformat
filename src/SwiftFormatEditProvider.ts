import * as vscode from "vscode";
import Current from "./Current";
import { handleFormatError } from "./UserInteraction";
import { existsSync } from "fs";
import { resolve } from "path";
import { execShellSync } from "./execShell";
import { request } from "http";

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

function getStartLine(document: vscode.TextDocument, range?: vscode.Range) {
  let prefix_range = new vscode.Range(
    new vscode.Position(0, 0),
    range?.end || wholeDocumentRange.end
  )
  let prefix_whole_text = document.getText(prefix_range)
  let input = document.getText(range)
  let stack: string[] = []

  console.log(prefix_whole_text)
  
  let indent = ""
  for (let i = prefix_whole_text.length - input.length; i >= 0; --i) {
    if (prefix_whole_text[i] == '{') {
      if (stack.length == 0) {
        // found start of indent
        // parse the indent prefix
        for (let j = i - 1; j >= 0; --j) { 
          if (prefix_whole_text[j] == '\n') { 
            for (let k = j + 1; k <= i; ++k) { 
              indent += prefix_whole_text[k];
            }
            break;
          }
        }
        break;
      } else { 
        stack.pop()
      }
    }
    else if (prefix_whole_text[i] == '}') { 
      stack.push('}')
    }
  }
  if (indent === "") { 
    return ""
  }
  return indent + " let Some_Random_Prefix_To_Formatt_sfsdgfgdfgdsdf = 0"
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

    const indentPrefix = getStartLine(request.document, rangeFromBeginingOfLine)
    const input = indentPrefix + "\n" + request.document.getText(rangeFromBeginingOfLine);
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
    const indexOfNextLine = indentPrefix.length
    if (newContents[indexOfNextLine] == '\n') {
      newContents = newContents.substring(indexOfNextLine + 1)
    } else {
      newContents = newContents.substring(indexOfNextLine)
    }
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
    if (position.line >= 0 && document.lineAt(position.line - 1).text.trim() === "") {
      return [];
    }
    const range = new vscode.Range(
      new vscode.Position(position.line - 1, 0), 
      new vscode.Position(position.line, position.character)
    )
    return format({
      document,
      range,
      formatting
    });
  }
}
