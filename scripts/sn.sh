#!/bin/bash

# old container running without touching build process
# 
if [ ! -f ./running.id ]
then
#    touch ./running.id
    echo 100 > ./running.id
    npm run build
fi

sleep 2

if [ -f ./node_modules/.bin/startSN ]
then
    echo 'startSn found'
else
    echo 'startSn not found'
    exit 1
fi

echo 'current directory:'

pwd

echo $*

./node_modules/.bin/startSN $*


