/**
 * Copyright 2016 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the “License”);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an “AS IS” BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import Alamofire
import SwiftyJSON
import UIKit

class API {

  let apiUrl = "https://CHANGEME.mybluemix.net";
  
  func get(endPoint: String,
    onSuccess: (JSON) -> Void, onFailure: () -> Void) -> Void {
    UIApplication.sharedApplication().networkActivityIndicatorVisible = true
    Alamofire.request(.GET, apiUrl + endPoint)
      .responseJSON { response in
        UIApplication.sharedApplication().networkActivityIndicatorVisible = false
        switch response.result {
        case .Success(let data):
          onSuccess(JSON(data));
        case .Failure(let error):
          print("error", error);
        }
    }
  }
}
