# Antilink
Just a quick antink module
# Hosting......

- clone the repo & cd in it,
  
```git clone https://github.com/frionode/antilink```

```cd antilink```

- Install depedencies,
  
  ```npm install mongoose baileys pino```
  
- setup mongoDB
  get mongo uri at mongodb.com or host your localy,
  
  Create a ```.env``` file in root dir and add your mongo
  
  ```MONGO=mongo_uri_here```
  
- Ignite the system

  ```node main.js```
  
  or if using pm2
  
  ```pm2 start main.js```
  
  to see logs (only when using pm2)
  
  ```pm2 logs```
  
  ### Just for security
