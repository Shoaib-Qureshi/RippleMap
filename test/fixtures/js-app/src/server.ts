const express = require('express');
import { helper } from '@/lib/util';

const app = express();

export function start() {
  helper();
  app.listen(3000);
}

app.get('/health', health);
app.post('/users', (req, res) => res.send(createUser(req.body)));

function health(req, res) {
  res.send('ok');
}

function createUser(body) {
  return helper(body);
}
