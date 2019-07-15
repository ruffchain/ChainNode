#!/bin/bash

echo "restore_storage ..."

echo 'current directory:'

pwd

echo $*

node ./dist/blockchain-sdk/src/tool/restore_storage.js $*

