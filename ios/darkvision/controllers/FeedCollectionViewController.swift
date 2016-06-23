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
import RDHCollectionViewGridLayout
import DateTools
import AlamofireImage
import Alamofire

private let reuseIdentifier = "FeedCell"

/// Displays a collection of videos.
class FeedCollectionViewController: UICollectionViewController {
  
  var videos = Videos(api: API());
  
  var refreshCtrl = UIRefreshControl();
  
  override func viewDidLoad() {
    super.viewDidLoad()

    UIDevice.currentDevice().beginGeneratingDeviceOrientationNotifications();
    NSNotificationCenter.defaultCenter().addObserver(self, selector: #selector(FeedCollectionViewController.orientationChanged), name: UIDeviceOrientationDidChangeNotification, object: nil)
    
    refreshCtrl.addTarget(self, action: #selector(FeedCollectionViewController.startRefresh), forControlEvents: .ValueChanged);
    collectionView?.addSubview(refreshCtrl);
    
    startRefresh();
  }
  
  func startRefresh() {
    print("Refreshing...");
    videos.load { (UIBackgroundFetchResult) -> Void in
      self.refreshCtrl.endRefreshing()
      if (UIBackgroundFetchResult == .NewData) {
        self.collectionView?.reloadData();
      }
    }
  }
  
  func orientationChanged() {
    updateLayout();
  }
  
  override func viewWillAppear(animated: Bool) {
    updateLayout();
  }
  
  func updateLayout() {
    
    let IPHONE = UIDevice.currentDevice().userInterfaceIdiom == .Phone;
    let PORTRAIT = UIApplication.sharedApplication().statusBarOrientation == .Portrait;
    
    let rdhLayout = self.collectionViewLayout as? RDHCollectionViewGridLayout
    rdhLayout?.lineSpacing = 5;
    rdhLayout?.itemSpacing = 5;
    
    if (IPHONE) {
      if (PORTRAIT) {
        print("Detected an iPhone in portrait");
        rdhLayout?.lineItemCount = 1;
        rdhLayout?.lineSize = 280; //(self.collectionView?.bounds.width)! / 2;
      } else {
        print("Detected an iPhone in landscape");
        rdhLayout?.lineItemCount = 2;
      }
    } else {
      if (PORTRAIT) {
        print("Detected an iPad in portrait");
        rdhLayout?.lineItemCount = 3;
      } else {
        print("Detected an iPad in landscape");
        rdhLayout?.lineItemCount = 3;
        rdhLayout?.lineSize = (self.collectionView?.bounds.width)! / 3;
      }
      
    }
  }

  override func numberOfSectionsInCollectionView(collectionView: UICollectionView) -> Int {
    return 1
  }
  
  
  override func collectionView(collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
    return videos.count()
  }
  
  override func collectionView(collectionView: UICollectionView, cellForItemAtIndexPath indexPath: NSIndexPath) -> UICollectionViewCell {
    // Configure the cell
    
    let cell = collectionView.dequeueReusableCellWithReuseIdentifier(reuseIdentifier,
      forIndexPath: indexPath) as! FeedCollectionViewCell
    
    let video = videos.videoAt(indexPath.row);
    cell.imageLabel.text = video.title()
    cell.imageLabel.verticalAlignment = .Top
    cell.imageView.af_setImageWithURL(NSURL(string:video.thumbnailUrl())!, placeholderImage: UIImage(named: "NoThumbnail"))
    cell.durationLabel.text = " " + video.duration() + " "
    return cell
  }
  
  override func prepareForSegue(segue: UIStoryboardSegue, sender: AnyObject?) {
    if (segue.identifier == "ShowVideo") {
      let cell = sender as! FeedCollectionViewCell;
      let indexPath = collectionView?.indexPathForCell(cell);
      let video = videos.videoAt(indexPath!.row)
      
      let videoController = segue.destinationViewController as! VideoController;
      videoController.setVideo(video)
    }
  }
  
}
