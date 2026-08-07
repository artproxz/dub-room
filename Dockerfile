FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
RUN mkdir -p /app/data
ENV PORT=3001
ENV DATA_DIR=/app/data
EXPOSE 3001
CMD ["node", "server/index.js"]
