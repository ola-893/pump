FROM node:22.23.1-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY near-demo ./near-demo
COPY app/src/lib ./app/src/lib
COPY deployments ./deployments
COPY tsconfig.json ./
ENV NODE_ENV=production
ENV PUMP_PUBLIC_DB=/data/pump.sqlite
EXPOSE 8080
CMD ["npm", "run", "start:public"]
