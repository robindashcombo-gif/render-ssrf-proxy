FROM node:20-slim
WORKDIR /app
COPY package.json index.js ./
EXPOSE 10000
CMD ["node", "index.js"]
