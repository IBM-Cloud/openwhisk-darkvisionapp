# Deploy Dark Vision manually in IBM Cloud

> :warning: Dark Vision can currently only be deployed in the US South region.

## Get the code

* Clone the app to your local environment from your terminal using the following command:

   ```
   git clone https://github.com/IBM-Cloud/openwhisk-darkvisionapp.git
   ```

* or Download and extract the source code from [this archive](https://github.com/IBM-Cloud/openwhisk-darkvisionapp/archive/master.zip)

## Create the IBM Cloud Services

***Note***: *if you have existing instances of these services, you don't need to create new instances.
You can simply reuse the existing ones.*

1. Open the IBM Cloud console

1. Create a Cloudant NoSQL DB service instance named **cloudant-for-darkvision**

1. Open the Cloudant service dashboard and create a new database named **openwhisk-darkvision**

1. Create a Watson Visual Recognition service instance named **visualrecognition-for-darkvision**

1. Create a Watson Speech to Text instance named **stt-for-darkvision**

1. Create a Natural Language Understanding instance named **nlu-for-darkvision**

1. (optional) Create a Cloud Object Storage service instance named **cloudobjectstorage-for-darkvision**

1. (optional) Inside the Cloud Object Storage, create a bucket where the media files will be stored.

## Deploy the web interface to upload videos and images

This simple web user interface is used to upload the videos or images and
visualize the results of each frame analysis.

1. Change to the **web** directory.

   ```
   cd openwhisk-darkvisionapp/web
   ```

1. If in the previous section you decided to use existing services instead of creating new ones, open **manifest.yml** and update the Cloudant service name.

1. If you configured a Cloud Object Storage service, make sure to add its name to the list of services in the **manifest.yml** *services* section or to uncomment the existing **cloudobjectstorage-for-darkvision** entry.

1. Push the application to IBM Cloud:

   ```
   bx cf push --nostart
   ```

1. By default, anyone can upload/delete/reset videos and images. You can restrict access to these actions by defining the environment variables *ADMIN_USERNAME* and *ADMIN_PASSWORD* on your application. This can be done in the IBM Cloud console or with the command line:

   ```
   bx cf set-env openwhisk-darkvision ADMIN_USERNAME admin
   bx cf set-env openwhisk-darkvision ADMIN_PASSWORD aNotTooSimplePassword
   ```

1. If you configured Cloud Object Storage service, set the endpoint and bucket name

   ```
   bx cf set-env openwhisk-darkvision COS_ENDPOINT s3-api.us-geo.objectstorage.softlayer.net
   bx cf set-env openwhisk-darkvision COS_BUCKET aUniqueBucketName
   ```

1. Start the app

   ```
   bx cf start openwhisk-darkvision
   ```

## Build the Frame Extractor Docker image

Extracting frames and audio from a video is achieved with ffmpeg. ffmpeg is not available to an Cloud Functions action written in JavaScript or Swift. Fortunately Cloud Functions allows to write an action as a Docker image and can retrieve this image from Docker Hub.

To build the extractor image, follow these steps:

1. Change to the ***processing/extractor*** directory.

1. Ensure your Docker environment works and that you have logged in Docker hub. To login use `docker login`.

1. Run

  ```
  ./buildAndPush.sh youruserid/yourimagename
  ```
  > Note: On some systems this command needs to be run with `sudo`.

1. After a while, your image will be available in Docker Hub, ready for Cloud Functions.

## Deploy Cloud Functions Actions

1. Change to the **root directory of the checkout**.

1. Copy the file named **template-local.env** into **local.env**

  ```
  cp template-local.env local.env
  ```

1. Get the service credentials for services created above and replace placeholders in `local.env`
with corresponding values (usernames, passwords, urls). These properties will be injected into
a package so that all actions can get access to the services.

  > If you configured an Object Storage service, specify its properties in this file too but uncommenting the placeholder variables.

1. Update the value of ***STT_CALLBACK_URL*** with the organization and space where the Cloud Functions actions will be deployed.

1. Update the value of ***DOCKER_EXTRACTOR_NAME*** with the name of the Docker
image you created in the previous section.

1. Ensure your [Cloud Functions command line interface](https://console.bluemix.net/openwhisk/cli) is property configured with:

  ```
  bx wsk list
  ```

  This shows the packages, actions, triggers and rules currently deployed in your Cloud Functions namespace.

1. Get dependencies used by the deployment script

  ```
  npm install
  ```

  > :warning: Node.js >= 6.9.1 is required

1. Create the action, trigger and rule using the script from the **root directory** directory:

  ```
  node deploy.js --install
  ```

  > The script can also be used to *--uninstall* the Cloud Functions artifacts to
  *--update* the artifacts if you change the action code.

### Register the speechtotext action as a callback for Speech to Text service

We need to tell the Speech to Text service where to call back when it has completed the audio processing.

1. Register the callback

  ```
  node deploy.js --register_callback
  ```

  > This command reuses the configuration of the variables STT_URL, STT_USERNAME, STT_PASSWORD, STT_CALLBACK_URL made in your local.env file.

**That's it! Use the web application to upload images/videos and view the results! You can also view the results using an iOS application as shown further down the [README](./README.md).**

## Running the web application locally

1. Change to the **web** directory

1. Get dependencies

  ```
  npm install
  ```

1. Start the application

  ```
  npm start
  ```

  Note: To find the Cloudant database (and Object Storage) to connect to when running locally,
  the application uses the environment variables defined in **local.env** in previous steps.

1. Upload videos through the web user interface. Wait for Cloud Functions to process the videos.
Refresh the page to look at the results.
