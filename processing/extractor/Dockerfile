FROM ubuntu:14.04

ENV DEBIAN_FRONTEND noninteractive

# Initial update and some basics.
# This odd double update seems necessary to get curl to download without 404 errors.
RUN apt-get update --fix-missing && \
apt-get install -y wget && \
apt-get update && \
apt-get install -y curl && \
apt-get update

# Get ffmpeg
RUN apt-get update --fix-missing && \
apt-get install -y software-properties-common && \
add-apt-repository -y ppa:mc3man/trusty-media && \
apt-get update --fix-missing && \
apt-get install -y ffmpeg

# install nodejs and npm
# based on https://github.com/nodejs/docker-node
ENV NODE_VERSION 8.11.1
RUN curl -SLO "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.gz" \
  && tar -xzf "node-v$NODE_VERSION-linux-x64.tar.gz" -C /usr/local --strip-components=1 \
  && rm "node-v$NODE_VERSION-linux-x64.tar.gz"

RUN mkdir /logs

ADD client /blackbox/client
ADD server /blackbox/server

RUN echo '{ "date": "'`date -u +"%Y-%m-%dT%H:%M:%SZ"`'" }' > /blackbox/client/build.json
RUN cd /blackbox/server; npm install
RUN cd /blackbox/client; npm install

# Final steps
EXPOSE 8080
CMD ["/bin/bash", "-c", "cd blackbox/server && node -v && node ./app.js"]
