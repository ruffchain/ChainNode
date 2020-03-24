#!/bin/bash

npm run build

echo "Trim data/ ..."

echo 'current directory:'

pwd

echo $*

ifnum= echo "$1" | grep '[^0-9]'
num="$1"

# node ./dist/blockchain-sdk/src/tool/trim.js $*
if [ "$1" = 'trim' -o "$1" = 'check' ]; then
    node --max-old-space-size=1024 ./dist/blockchain-sdk/src/tool/trim.js $*
elif [ -z "$ifnum" ]; then
    echo "Number:" "$1"
    shift
    echo $*
    node --max-old-space-size="$num" ./dist/blockchain-sdk/src/tool/trim.js $*
else
    echo 'Wrong arguments num'
    echo 'hello ending'
fi
