//------------------------------------------------------------------------------
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//------------------------------------------------------------------------------
(function () {
  // listen for request sent over XHR and automatically show/hide spinner
  angular.module('ngLoadingSpinner', [])
    .directive('spinner', ['$http', function ($http) {
      return {
        link: function (scope, elm, attrs) {
          scope.isLoading = function () {
            return $http.pendingRequests.length > 0;
          };
          scope.$watch(scope.isLoading, function (loading) {
            if (loading) {
              document.getElementById('loadingProgress').style.visibility = "visible";
            } else {
              document.getElementById('loadingProgress').style.visibility = "hidden";
            }
          });
        }
      };
    }]);

  // angular app initialization
  var app = angular.module('app', [
    'ngMaterial',
    'ngLoadingSpinner',
    'ui.router',
    'angularCSS',
    'ngFileUpload',
  ]);

  app.config(function($stateProvider, $urlRouterProvider) {

    $urlRouterProvider.otherwise('/');

    $stateProvider
      .state('home', {
        url: '/',
        templateUrl: 'routes/home/home.html',
        css: 'routes/home/home.css'
      });

    $stateProvider
      .state('about', {
        url: '/about',
        templateUrl: 'routes/about/about.html',
        css: 'routes/about/about.css'
      });

    $stateProvider
      .state('video', {
        url: '/videos/:videoId',
        templateUrl: 'routes/video/video.html',
        css: 'routes/video/video.css',
      });
  });

  app.config(function($mdProgressCircularProvider) {
    $mdProgressCircularProvider.configure({
      strokeWidth: 4
    });
  });

  app
    .filter('formatSentence', [
      function() {
        return function(value) {
          var result = value.trim().replace(/%HESITATION/g, '...');
          return result.substr(0, 1).toUpperCase() + result.substr(1);
        }
      }
    ])
    .filter('formatPercent', [
      function () {
        return function (value) {
          return Math.round(value * 100);
        }
      }
    ])
    .filter('formatSeconds', [
    function () {
        return function (value) {
          var date = new Date(null);
          date.setSeconds(value);
          return date.toISOString().substr(14, 5);
        }
    }
    ]);

  app.controller('MainController', ['$scope', '$rootScope', '$state', '$http', 'Upload', function($scope, $rootScope, $state, $http, Upload) {
    $scope.lightTheme = true;
    $scope.toggleLight = function() {
      $scope.lightTheme = !$scope.lightTheme;
      var theme = $scope.lightTheme ? 'css/darkvision-light.css' : 'css/darkvision-dark.css'
      document.getElementById("theme").href = theme;
    };

    $scope.isUploading = false;
    $scope.uploadProgress = 0;

    $scope.uploadFile = function(file, errFiles) {
      console.log('Uploading', file, errFiles);
      $scope.f = file;
      $scope.errFile = errFiles && errFiles[0];
      if (file) {
        $scope.isUploading = true;
        $scope.uploadProgress = 0;

        file.upload = Upload.upload({
          url: '/upload',
          data: { file: file }
        });

        // this should trigger the basic auth login/password
        $http.get('/upload').then(function(response) {
          file.upload.then(function(response) {
            $scope.isUploading = false;
            console.log('Upload complete', response.data);
          }, function(response) {
            $scope.isUploading = false;
            console.log('Upload failed', response.status, response.data);
          }, function(evt) {
            $scope.uploadProgress = Math.min(100, parseInt(100.0 * evt.loaded / evt.total));
          });
        }).catch(function () {
          $scope.isUploading = false;
        });
      }
    };
  }]);

}());
