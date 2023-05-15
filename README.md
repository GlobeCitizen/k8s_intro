
# Application Deployment using Kubernetes

This guide will help you deploy a Node.js API and Redis cache using Kubernetes (K8s).




## Prerequisites 

- Docker installed on your local machine.
- Kubernetes (K8s) cluster set up.
    
## Steps
### 1. Build and Push Docker Images

#### API Image
1. Build the Docker image for the API:
```bash
docker build -t <your-registry>/api:v1 .
```

2. Push the API image to your local Docker registry:
```bash
docker push <your-registry>/api:v1
```

#### Redis Image
1. Build the Docker image for Redis cache:
```bash
docker build -t <your-registry>/redis:v1 .
```
2. Push the Redis image to your local Docker registry:
```bash
docker push <your-registry>/redis:v1
```
### 2. Deploy API and Redis to Kubernetes
#### API Deployment

1. Create a deployment YAML file named api-deployment.yaml:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-deployment
spec:
  replicas: 1
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: <your-registry>/api:v1
          ports:
            - containerPort: 1337
```

2. Apply the API deployment to the Kubernetes cluster:
```bash
kubectl apply -f api-deployment.yaml
```
#### Redis Deployment
1.Create a deployment YAML file named redis-deployment.yaml:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis-deployment
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: <your-registry>/redis:v1
          ports:
            - containerPort: 6379
```
2. Apply the Redis deployment to the Kubernetes cluster:
```bash
kubectl apply -f redis-deployment.yaml
```

### 3. Expose the API Service using NGINX Ingress
1. Create an Ingress YAML file named api-ingress.yaml:
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
spec:
  rules:
    - host: <your-api-domain.com>
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 80
```

2. Apply the API Ingress resource to define the routing rules:

```bash
kubectl apply -f api-ingress.yaml
```
### 4. Verify Deployment
1. Check the status of the API and Redis deployments:
```bash
kubectl get deployments
```
2. Verify that the API and Redis pods are running:
```bash
kubectl get pods
```
3. Check the status of the Ingress resource:
```bash
kubectl get ingress
```
