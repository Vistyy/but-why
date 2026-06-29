FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl jq \
  && rm -rf /var/lib/apt/lists/*

ARG AGENT_UID=1000
ARG AGENT_GID=1000

RUN npm install -g @mariozechner/pi-coding-agent

RUN mkdir -p /home/agent \
  && chown ${AGENT_UID}:${AGENT_GID} /home/agent

USER ${AGENT_UID}:${AGENT_GID}
WORKDIR /home/agent
ENTRYPOINT ["sleep", "infinity"]
