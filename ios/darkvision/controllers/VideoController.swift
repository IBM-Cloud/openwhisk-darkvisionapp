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
import UIKit
import SwiftyJSON
import AlamofireImage
import TTTAttributedLabel
import Cosmos
import TagListView

class VideoController: UIViewController {
  
  @IBOutlet weak var imageLabel: TTTAttributedLabel!
  @IBOutlet weak var imageView: UIImageView!
  @IBOutlet weak var backgroundImageView: UIImageView!
  
  @IBOutlet weak var viewCountLabel: UILabel!
  @IBOutlet weak var starRating: CosmosView!
  @IBOutlet weak var createdAtLabel: TTTAttributedLabel!
  @IBOutlet weak var tagListView: TagListView!
  var video: Video?;
  var videoDetailController: VideoDetailController?;
  
  override func viewDidLoad() {
    if (UIDevice.current.userInterfaceIdiom == UIUserInterfaceIdiom.pad) {
      tagListView.textFont = UIFont.systemFont(ofSize: 20)
    } else {
      tagListView.textFont = UIFont.systemFont(ofSize: 15)
      tagListView.paddingX = 5
      tagListView.paddingY = 5
      tagListView.marginX = 5
      tagListView.marginY = 5
    }
    
    createdAtLabel.verticalAlignment = .top
    
    updateFields()
  }

  @IBAction func onThumbnailTapped(_ sender: AnyObject) {
    setCurrentImage(video!.thumbnailUrl())
  }
  
  func setVideo(_ video: Video) {
    print("Setting video to", video);
    self.video = video;
    video.load { (UIBackgroundFetchResult) -> Void in
      self.updateFields();
    }
  }
  
  func updateFields() {
    if (video == nil) {
      return
    }
    
    self.title = video!.title()
    setCurrentImage(video!.thumbnailUrl())
        
    imageLabel.verticalAlignment = .top
    imageLabel.text = video?.title();
    
    createdAtLabel.text = video?.createdAgo()
    
    viewCountLabel.text = String(video!.viewCount) + " views"
    starRating.rating = video!.starRating
    
    tagListView.removeAllTags()
    for keyword in video!.keywords() {
      tagListView.addTag(keyword["class"].stringValue).onTap = { [weak self] tagView in
        self!.setCurrentImage(keyword["image_url"].stringValue)
      }
    }
    
    videoDetailController?.setVideo(video!);
    videoDetailController?.collectionView?.reloadData();    
  }
  
  func setCurrentImage(_ imageUrl : String) {
    print("Changing image to", imageUrl)
    imageView.af_setImage(withURL: URL(string:imageUrl)!, placeholderImage: imageView.image, filter: nil, imageTransition: .crossDissolve(0.5), completion: { response in
      if (response.result.isSuccess) {
        self.backgroundImageView.image = BlurFilter().filter(response.result.value!)
      }
    })
  }
  
  override func prepare(for segue: UIStoryboardSegue, sender: Any?) {
    if (segue.identifier == "VideoDetailControllerSegue") {
      videoDetailController =
        segue.destination as? VideoDetailController
      videoDetailController?.videoController = self
    }
  }
}
