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
import AlamofireImage
import Alamofire

private let reuseIdentifier = "FeedCell"

/// Displays a collection of videos.
class FeedCollectionViewController: UICollectionViewController {
  
  var videos = Videos(api: API());
  
  var refreshCtrl = UIRefreshControl();
  
  override func viewDidLoad() {
    super.viewDidLoad()

    UIDevice.current.beginGeneratingDeviceOrientationNotifications();
    NotificationCenter.default.addObserver(self, selector: #selector(self.orientationChanged),
                                           name: UIDevice.orientationDidChangeNotification, object: nil)
    
    refreshCtrl.addTarget(self, action: #selector(FeedCollectionViewController.startRefresh), for: .valueChanged);
    collectionView?.addSubview(refreshCtrl);
    
    startRefresh();
  }
  
  @objc func startRefresh() {
    print("Refreshing...");
    videos.load { (UIBackgroundFetchResult) -> Void in
      self.refreshCtrl.endRefreshing()
      if (UIBackgroundFetchResult == .newData) {
        self.collectionView?.reloadData();
      }
    }
  }
  
  @objc func orientationChanged() {
    updateLayout();
  }
  
  override func viewWillAppear(_ animated: Bool) {
    updateLayout();
  }
  
  func updateLayout() {
    
    let IPHONE = UIDevice.current.userInterfaceIdiom == .phone;
    let PORTRAIT = UIApplication.shared.windows.first?.windowScene?.interfaceOrientation.isPortrait ?? false;
    
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

  override func numberOfSections(in collectionView: UICollectionView) -> Int {
    return 1
  }
  
  
  override func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
    return videos.count()
  }
  
  override func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
    // Configure the cell
    
    let cell = collectionView.dequeueReusableCell(withReuseIdentifier: reuseIdentifier,
      for: indexPath) as! FeedCollectionViewCell
    
    let video = videos.videoAt((indexPath as NSIndexPath).row);
    cell.imageLabel.text = video.title()
    cell.imageLabel.verticalAlignment = .top
    cell.imageView.af_setImage(withURL: URL(string:video.thumbnailUrl())!, placeholderImage: UIImage(named: "NoThumbnail"))
    cell.durationLabel.text = " " + video.duration() + " "
    return cell
  }
  
  override func prepare(for segue: UIStoryboardSegue, sender: Any?) {
    if (segue.identifier == "ShowVideo") {
      let cell = sender as! FeedCollectionViewCell;
      let indexPath = collectionView?.indexPath(for: cell);
      let video = videos.videoAt((indexPath! as NSIndexPath).row)
      
      let videoController = segue.destination as! VideoController;
      videoController.setVideo(video)
    }
  }
  
}
