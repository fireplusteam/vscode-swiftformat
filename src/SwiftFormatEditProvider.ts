import * as vscode from "vscode";
import Current from "./Current";
import { handleFormatError } from "./UserInteraction";
import { existsSync } from "fs";
import { resolve } from "path";
import { execShellSync } from "./execShell";
import { getStartLine } from "./parseClass";

const wholeDocumentRange = new vscode.Range(
  0,
  0,
  Number.MAX_SAFE_INTEGER - 1,
  Number.MAX_SAFE_INTEGER - 1,
);

function rootPathForDocument(document: vscode.TextDocument): string {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  return (
    (workspaceFolder && workspaceFolder.uri.fsPath) ||
    vscode.workspace.rootPath ||
    "./"
  );
}

function userDefinedFormatOptionsForDocument(document: vscode.TextDocument): {
  options: string[];
  hasConfig: boolean;
} {
  const formatOptions = Current.config.formatOptions();
  if (formatOptions.indexOf("--config") != -1)
    return { options: formatOptions, hasConfig: true };
  const rootPath = rootPathForDocument(document);
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

function format(request: {
  document: vscode.TextDocument;
  parameters?: string[];
  range?: vscode.Range;
  formatting: vscode.FormattingOptions;
  triggerChar?: string;
}): vscode.TextEdit[] {
  try {
    const swiftFormatPath = Current.config.swiftFormatPath(request.document);
    if (swiftFormatPath == null) {
      return [];
    }
    const input = request.document.getText();
    const endPos = new vscode.Position(
      request.range?.end.line || wholeDocumentRange.end.line,
      request.range?.end.character || wholeDocumentRange.end.character,
    );
    let formatterInput = input.substring(0, request.document.offsetAt(endPos));
    let wasAdded = false;
    // when a user taps on \n, new line is only whitespaces, causing swiftformat to remove it entirely, but we want to keep it
    if (
      request.range !== undefined &&
      formatterInput.split("\n").at(-1)?.match(/\S/) === null
    ) {
      formatterInput += "f"; // dummy character to preserve trailing whitespace line
      wasAdded = true;
    }

    // const trailingInput = request.document.getText(
    //   new vscode.Range(endPos, wholeDocumentRange.end),
    // );

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
        ...(request.range !== undefined
          ? [
              "--line-range",
              `${request.range!.start.line.toString()},${(
                request.range!.end.line + 1
              ).toString()}`,
            ]
          : []),
      ],
      {
        encoding: "utf8",
        cwd: rootPathForDocument(request.document),
        input: formatterInput,
      },
    );
    function extractFormattedPiece(range: vscode.Range | undefined) {
      if (wasAdded) {
        newContents = newContents.slice(0, -1);
      }
      if (range === undefined) {
        return newContents;
      }
      const modifiedContent = newContents.substring(
        request.document.offsetAt(range.start),
      );
      if (
        request.triggerChar !== undefined &&
        ":,={".includes(request.triggerChar)
      ) {
        return modifiedContent.trimEnd();
      }
      return modifiedContent;
    }
    const formattedText = extractFormattedPiece(request.range);
    if (formattedText === undefined) {
      return [];
    }
    // console.log("Formatted Text:", formattedText);

    const rangeToReplace =
      request.range !== undefined
        ? new vscode.Range(request.range.start, endPos)
        : wholeDocumentRange;
    // console.log("Text to replace:", request.document.getText(rangeToReplace));

    return [vscode.TextEdit.replace(rangeToReplace, formattedText)];
  } catch (error) {
    handleFormatError(error, request.document);
    return [];
  }
}

/// this's workaround to fix cursor after . is formatted, as vim has a bug
async function moveCursor(
  startLinePos: number,
  startCharacterPos: number,
  beforeEdit: string,
  afterEdit: string,
) {
  if (vscode.window.activeTextEditor) {
    const countNewLines = (line: string) => {
      let cnt = 0;
      for (const char of line) {
        if (char === "\n") cnt++;
      }
      return cnt;
    };
    const extractLastLine = (content: string) => {
      let ret = "";
      for (let i = content.length - 1; i >= 0; --i) {
        if (content[i] === "\n") {
          break;
        }
        ret += content[i];
      }
      return ret;
    };
    const diffLines = countNewLines(afterEdit) - countNewLines(beforeEdit);
    let charDiff =
      startCharacterPos +
      extractLastLine(afterEdit).length -
      extractLastLine(beforeEdit).length;
    const myPos = new vscode.Position(startLinePos + diffLines, charDiff);
    setTimeout(() => {
      if (vscode.window.activeTextEditor) {
        vscode.window.activeTextEditor.selections = [
          new vscode.Selection(myPos, myPos),
        ];
      }
    }, 1);
  }
}

export class SwiftFormatEditProvider
  implements
    vscode.DocumentRangeFormattingEditProvider,
    vscode.DocumentFormattingEditProvider,
    vscode.OnTypeFormattingEditProvider
{
  // xcrun swiftformat --rules | fzf
  static onTypeParameters = [
    "--fragment",
    "true",
    "--disable",
    "unusedArguments",
    "--disable",
    "trailingClosures",
    "--disable",
    "redundantSelf",
    "--disable",
    "emptyBraces",
    "--disable",
    "redundantParens",
    "--disable",
    "redundantVoidReturnType",
    "--disable",
    "sortedImports",
    "--disable",
    "redundantTypedThrows",
    "--disable",
    "redundantGet",
    "--disable",
    "redundantBackticks",
    "--disable",
    "redundantBreak",
    "--disable",
    "redundantClosure",
    "--disable",
    "redundantExtensionACL",
    "--disable",
    "redundantFileprivate",
    "--disable",
    "redundantInit",
    "--disable",
    "redundantLet",
    "--disable",
    "redundantLetError",
    "--disable",
    "redundantNilInit",
    "--disable",
    "redundantObjc",
    "--disable",
    "redundantOptionalBinding",
    "--disable",
    "redundantPattern",
    "--disable",
    "redundantRawValues",
    "--disable",
    "redundantReturn",
    "--disable",
    "redundantType",
    // "--disable",
    // "spaceInsideBraces",
    "--disable",
    // don't remove new line with only spaces
    "blankLinesAtStartOfScope",
  ];
  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    formatting: vscode.FormattingOptions,
  ) {
    return format({
      document,
      parameters: SwiftFormatEditProvider.onTypeParameters,
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
    try {
      if (ch == "\n") {
        startLine = Math.max(0, position.line - 1);
      } else if (ch == "}") {
        startLine = getStartLine(document, position, "{", "}").line;
      } else if (ch == ")") {
        startLine = getStartLine(document, position, "(", ")").line;
      } else if (ch == "]") {
        startLine = getStartLine(document, position, "[", "]").line;
      }
    } catch {
      return [];
    }

    const range = new vscode.Range(new vscode.Position(startLine, 0), position);

    const result = format({
      document,
      parameters: SwiftFormatEditProvider.onTypeParameters,
      range,
      formatting,
      triggerChar: ch,
    });
    // this is workaround to fix cursor after . is formatted, as vim has a bug
    // but with new swiftformat version this seems to be not needed
    if (result.length > 0 && vscode.window.activeTextEditor) {
      const edit = result[0];
      const before = document.getText(edit.range);
      const after = edit.newText;
      const selection = vscode.window.activeTextEditor.selection;
      moveCursor(selection.end.line, selection.end.character, before, after);
    }

    return result;
  }
}
