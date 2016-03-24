var fs = require('fs');
var spawn = require('child_process').spawn;

function ExtractorService(rawLog, logger) {

  var server = undefined;

  /**
   * Starts the server.
   * 
   * @param app express app
   */
  this.start = function start(app) {
    var self = this;
    server = app.listen(app.get('port'), function () {
      var host = server.address().address;
      var port = server.address().port;
      logger.info('[start] listening at http://%s:%s', host, port);
    });
  }

  /**
   * req.body = { main: String, code: String, name: String }
   */
  this.initCode = function initCode(req, res) {
    res.status(200).send();
  }

  /**
   * req.body = { value: Object, meta { activationId : int } }
   */
  this.runCode = function runCode(req, res) {
    var meta = (req.body || {}).meta;
    var value = (req.body || {}).value;
    rawLog.log('[Running]: meta =', meta);
    rawLog.log('[Running]: value =', value);
    if (typeof value != 'string')
      value = JSON.stringify(value);
    var proc = spawn("node", ["/blackbox/client/extract.js", value], {
      cwd: "/blackbox/client"
    });
    var output = ''
    proc.stdout.on('data', function (data) {
      rawLog.log('stdout: ' + data);
      output += data;
    });
    proc.stderr.on('data', function (data) {
      rawLog.log('stderr: ' + data);
      output += data;
    });
    proc.on('close', function (code) {
      rawLog.log('child process exited with code ' + code);
      var result = {
        'result': {
          'msg': output
        }
      };
      res.status(200).json(result);
    });
  }

}

ExtractorService.getService = function (rawLog, logger) {
  return new ExtractorService(rawLog, logger);
}

module.exports = ExtractorService;
