import { start } from './server';
import { util } from './lib/util.js';
import React from 'react';

export function main() {
  start();
  util();
}
