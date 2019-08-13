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

if [  "$1" = 'miner'  -o  "$1" = 'peer'  ]
then
    node --inspect=0.0.0.0:3456 ./dist/blockchain-sdk/src/tool/host.js $*
else
    echo 'Wrong arguments num'
    echo 'hello ending'
    /bin/bash
fi
