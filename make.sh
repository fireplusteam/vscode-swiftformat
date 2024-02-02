#!/bin/bash

npm install

npm run compile
vsce package

code --install-extension vscode-swiftformat-xcode-1.7.7.vsix

vsce publish