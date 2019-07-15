#!/bin/bash

npm run build

echo 'Run custom command'

pwd

echo $*

node $*
