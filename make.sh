#!/bin/bash

npm run compile
vsce package

code --install-extension vscode-swiftformat-fixed-1.6.7.vsix