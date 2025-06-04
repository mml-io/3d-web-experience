#!/bin/bash

set -ex

# Check for GITHUB_SHA
if [ -z "$GITHUB_SHA" ]; then
  echo "GITHUB_SHA is not set"
  exit 1
fi

# Retag the docker image with the GITHUB_SHA
DOCKER_IMAGE="europe-west2-docker.pkg.dev/moderately-engaging-reindeer/deltanet-prototype/delta-net-web-client-example:$GITHUB_SHA"
docker tag "delta-net-web-client-example:latest" $DOCKER_IMAGE

docker push "$DOCKER_IMAGE"
