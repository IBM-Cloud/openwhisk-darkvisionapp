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
  function ImagesService($http, $q) {
    console.log("Initializing ImagesService...");

    return {
      all: function () {
        var deferred = $q.defer();
        $http.get("/api/images").then(response => response.data).then(function (data) {
          deferred.resolve(data);
        }).catch(function () {
          deferred.reject();
        });
        return deferred.promise;
      },
      reset: function (image) {
        var deferred = $q.defer();
        $http.get("/api/images/" + encodeURIComponent(image._id) + "/reset").then(response => response.data).then(function (data) {
          deferred.resolve(data);
        }).catch(function () {
          deferred.reject();
        });
        return deferred.promise;
      },
      delete: function (image) {
        var deferred = $q.defer();
        $http.delete("/api/images/" + encodeURIComponent(image._id)).then(response => response.data).then(function (data) {
          deferred.resolve(data);
        }).catch(function () {
          deferred.reject();
        });
        return deferred.promise;
      }
    };
  }

  angular.module('app')
    .service('ImagesService', ['$http', '$q', ImagesService]);
}());
