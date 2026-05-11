FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# 微信云托管默认对外端口 80
ENV PORT=80
EXPOSE 80

CMD ["node", "index.js"]
