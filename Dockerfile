FROM ubuntu:18.04
LABEL maintainer="yang o3"
LABEL Name="RFC docker image"
LABEL Version="1.14.9"
RUN apt-get update && apt search linux-headers-$(uname -r) &&\
    apt-get install -y build-essential \
    libssl-dev \
    python \
    vim \
    git \
    curl \
    net-tools \
    sudo &&\
    apt-get clean

RUN useradd -m ruff -g root && echo "ruff:123456" | chpasswd && adduser ruff sudo

WORKDIR /home/ruff
ENV NVM_DIR /home/ruff/.nvm
ENV NODE_VERSION 10.16.2

RUN curl https://raw.githubusercontent.com/creationix/nvm/v0.25.0/install.sh | bash \
    && . $NVM_DIR/nvm.sh \
    && nvm ls-remote \
    && nvm install  v$NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default
ENV NODE_PATH $NVM_DIR/versions/node/v$NODE_VERSION/lib/node_modules
ENV PATH      $NVM_DIR/versions/node/v$NODE_VERSION/bin:$PATH

ADD ./chainsdk/package*.json /tmp/
RUN cd /tmp && npm install --registry=https://registry.npm.taobao.org --verbose

RUN node --version
COPY ./chainsdk /home/ruff/chainsdk
COPY ./ruff /home/ruff/chainsdk/ruff
RUN cd /home/ruff/chainsdk && cp -a /tmp/node_modules /home/ruff/chainsdk

#
#RUN cd /home/ruff/chainsdk && npm install --registry=https://registry.npm.taobao.org --verbose

WORKDIR /home/ruff/chainsdk
# USER ruff
CMD /bin/bash
