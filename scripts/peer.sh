#!/bin/bash

# old container running without touching build process
# 
if [ ! -f ./running.id ]
then
#    touch ./running.id
    echo 100 > ./running.id
    npm run build
fi

node ./dist/blockchain-sdk/src/tool/host.js peer $*
