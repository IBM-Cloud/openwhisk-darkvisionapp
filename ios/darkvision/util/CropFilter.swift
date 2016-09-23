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
import AlamofireImage

// Returns only a part of an image
public struct CropFilter: ImageFilter {
  
  public let x: Int
  public let y: Int
  public let width: Int
  public let height: Int
  
  public init(x: Int, y: Int, width: Int, height: Int) {
    self.x = x
    self.y = y
    self.width = width
    self.height = height
  }
  
  public var filter : (Image) -> Image {
    return { image in
      let fromRect = CGRect(x: self.x, y: self.y, width: self.width, height: self.height)
      let imageRef = image.cgImage?.cropping(to: fromRect)
      return UIImage(cgImage: imageRef!, scale: UIScreen.main.scale, orientation: image.imageOrientation)
    }
  }
  
}
