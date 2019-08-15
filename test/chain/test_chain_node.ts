import 'mocha';
import * as path from 'path';
import * as fs from 'fs-extra';
const assert = require('assert');
import {Transaction, BlockStorage, BlockHeader, initLogger, HeaderStorage } from '../../src/core';

// TODO:
