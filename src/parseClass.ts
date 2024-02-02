import { close } from "fs";
import * as vscode from "vscode";

enum Commented {
  notCommented,
  singleCommented,
  multiCommented,
  quoted,
  multiQuoted,
}

export function preCalcCommentedCode(text: string) {
  const line = [] as boolean[];
  let commented = Commented.notCommented;
  let openQuote = "";
  for (let i = 0; i < text.length - 1; ) {
    switch (commented) {
      case Commented.notCommented:
        if (text.slice(i, i + 2) === "//") {
          commented = Commented.singleCommented;
          line.push(true, true);
        } else if (text.slice(i, i + 2) === "/*") {
          commented = Commented.multiCommented;
          line.push(true, true);
        } else if (text.slice(i, i + 3) === '"""') {
          commented = Commented.multiQuoted;
          line.push(true, true, true);
        } else if (text[i] === '"' || text[i] === "'") {
          commented = Commented.quoted;
          openQuote = text[i];
          line.push(true);
        } else {
          line.push(false);
        }
        break;
      case Commented.singleCommented:
        if (text[i] === "\n") {
          commented = Commented.notCommented;
        }
        line.push(true);
        break;
      case Commented.multiCommented:
        if (text.slice(i, i + 2) === "*/") {
          commented = Commented.notCommented;
          line.push(true, true);
        } else {
          line.push(true);
        }
        break;
      case Commented.quoted:
        if (text.slice(i, i + 2) === '\\"' || text.slice(i, i + 2) === "\\'") {
          line.push(true, true);
        } else if (text[i] === openQuote) {
          commented = Commented.notCommented;
          line.push(true);
        } else {
          line.push(true);
        }
        break;
      case Commented.multiQuoted:
        if (text.slice(i, i + 2) === '\\"') {
          line.push(true, true);
        } else if (text.slice(i, i + 3) === '"""') {
          commented = Commented.notCommented;
          line.push(true, true, true);
        } else {
          line.push(true);
        }
        break;
    }
    i = line.length;
  }
  return line;
}

export function isCommented(commented: boolean[], start: number, end: number) {
  for (let i = start; i < end; ++i) {
    if (commented[i]) {
      return true;
    }
  }
  return false;
}

/// open and close brackets should batch each other
/// if open brackets is "{(" should be "})"
export function getStartLine(
  document: vscode.TextDocument,
  position: vscode.Position,
  openBracket = "{",
  closeBracket = "}",
) {
  const text = document.getText();
  const commented = preCalcCommentedCode(text);

  const lastBracket = text[document.offsetAt(position) - 1];
  const validClosedBrackets = "})]";
  const validOpenBrackets = "{([";
  if (!validClosedBrackets.includes(closeBracket)) {
    return position;
  }

  const stack = [lastBracket];

  for (let i = document.offsetAt(position) - 2; i >= 0; --i) {
    if (commented[i]) {
      continue;
    }
    const char = text[i];
    if (validClosedBrackets.includes(char)) {
      stack.push(char);
    } else if (validOpenBrackets.includes(char)) {
      if (stack.length === 0) {
        throw new Error("Mismatched brackets");
      }
      if (
        validOpenBrackets.indexOf(char) !==
        validClosedBrackets.indexOf(stack[stack.length - 1])
      ) {
        // bracket is wrong, here we should finish
        throw new Error("Mismatched brackets");
      }
      stack.pop();
      if (stack.length == 0 && char === openBracket) {
        return document.positionAt(i);
      }
    }
  }
  if (stack.length !== 0) {
    throw new Error("Mismatched brackets");
  }
  return document.positionAt(0);
}
