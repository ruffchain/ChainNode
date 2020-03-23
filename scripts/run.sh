#!/bin/bash

# old container running without touching build process
#
# if [ ! -f ./running.id ]
# then
# #    touch ./running.id
#     echo 100 > ./running.id
#     npm run build
# fi
npm run build

echo 'hello'
echo $*

ifnum= echo "$1" | grep '[^0-9]'
num="$1"

if [ "$1" = 'miner' -o "$1" = 'peer' ]; then
    node --max-old-space-size=1024 ./dist/blockchain-sdk/src/tool/host.js $*
elif [ -z "$ifnum" ]; then
    echo "Number:" "$1"
    shift
    echo $*
    node --max-old-space-size="$num" ./dist/blockchain-sdk/src/tool/host.js $*
else
    echo 'Wrong arguments num'
    echo 'hello ending'
    # /bin/bash
fi
