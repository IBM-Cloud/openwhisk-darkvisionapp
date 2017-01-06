const bodyParser = require('body-parser');
const express = require('express');

const extractor = value => new Promise((resolve) => {
  console.log('[running] value =', value);
  const spawn = require('child_process').spawn;
  const proc = spawn('node', ['/blackbox/client/extract.js', value], {
    cwd: '/blackbox/client'
  });

  let output = '';
  proc.stdout.on('data', (data) => {
    console.log('[stdout] ' + data); // eslint-disable-line prefer-template
    output += data;
  });
  proc.stderr.on('data', (data) => {
    console.log('[stderr] ' + data); // eslint-disable-line prefer-template
    output += data;
  });
  proc.on('close', (code) => {
    console.log('[exit] with code', code);
    const result = {
      result: {
        msg: output
      }
    };
    resolve(result);
  });
});

const invokeExtractor = args => extractor(JSON.stringify(args));

const app = express();
app.set('port', 8080);
app.use(bodyParser.json());

const server = app.listen(app.get('port'), () => {
  const host = server.address().address;
  const port = server.address().port;
  console.log('[start] listening at http://%s:%s', host, port);
});

app.post('/init', (req, res) => res.send());
app.post('/run', (req, res) => {
  console.log('[run]', req.body);
  const args = req.body.value;
  invokeExtractor(args).then((result) => {
    res.json(result);
  }).catch((err) => {
    console.log(err);
    res.status(500).json({ error: err });
  });
});
