'use strict';

const bodyParser = require('body-parser')
const express = require('express')
const app = express()

app.set('port', 8080)
app.use(bodyParser.json())

const server = app.listen(app.get('port'), function() {
  const host = server.address().address;
  const port = server.address().port;
  console.log('[start] listening at http://%s:%s', host, port);
});

const run_req = (req, res) => {
  console.log('openwhisk invoke request: ', req.body)
  const args = req.body.value
  invoke_extractor(args).then(result => {
    res.json(result)
  }).catch(err => {
    console.log(err);
    res.status(500).json({error: err});
  })
}

app.post('/init', (req, res) => res.send())
app.post('/run',  run_req);

const invoke_extractor = (args) => {
  return extractor(JSON.stringify(args));
}

const extractor = (value) => {
  return new Promise((resolve, reject) => {
    console.log('[running] value =', value);
    const spawn = require('child_process').spawn;
    const proc = spawn("node", ["/blackbox/client/extract.js", value], {
      cwd: "/blackbox/client"
    });

    let output = ''
    proc.stdout.on('data', function (data) {
      console.log('stdout: ' + data);
      output += data;
    });
    proc.stderr.on('data', function (data) {
      console.log('stderr: ' + data);
      output += data;
    });
    proc.on('close', function (code) {
      console.log('child process exited with code ' + code);
      const result = {
        'result': {
          'msg': output
        }
      };
      resolve(result);
    });
  });
}
