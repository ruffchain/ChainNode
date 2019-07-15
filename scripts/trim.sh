#!/bin/bash

npm run build

echo "Trim data/ ..."

echo 'current directory:'

pwd

echo $*

node ./dist/blockchain-sdk/src/tool/trim.js $*

