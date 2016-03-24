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
  // angular app initialization
  var app = angular.module('app', ['ui.router']);

  app.config(function ($stateProvider, $urlRouterProvider) {

    $urlRouterProvider.otherwise("/videos");

    $stateProvider
      .state('videos', {
        url: '/videos',
        templateUrl: 'partials/videos.html'
      });

    $stateProvider
      .state('video', {
        url: '/videos/:videoId',
        templateUrl: 'partials/video.html'
      });

    $stateProvider
      .state('images', {
        url: '/images',
        templateUrl: 'partials/images.html'
      });

  });

  app
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
          return date.toISOString().substr(11, 8);
        }
    }
    ]);

}());
