#!/bin/bash

npm install

npm run compile
vsce package

code --install-extension vscode-swiftformat-xcode-1.7.9.vsix

vsce publish