import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('./workloads/', import.meta.url);
mkdirSync(dir, { recursive: true });

const services = [
  ['api-gateway', 2, 'hpa', 10],
  ['identity-service', 2, 'hpa', 6],
  ['merchant-service', 2, 'hpa', 6],
  ['payment-service', 2, 'hpa', 10],
  ['ledger-service', 2, 'hpa', 8],
  ['settlement-service', 2, 'hpa', 6],
  ['reconciliation-service', 2, 'hpa', 6],
  ['risk-service', 2, 'hpa', 6],
  ['notification-service', 1, 'keda', 10],
  ['acquirer-simulator', 1, 'none', 1],
];

for (const [name, replicas, scaler, maxReplicas] of services) {
  const envName = name.toUpperCase().replaceAll('-', '_');
  const pdb =
    replicas >= 2
      ? `---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ${name}
  namespace: ledgerflow
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: ${name}
`
      : '';
  const hpa =
    scaler === 'hpa'
      ? `---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${name}
  namespace: ledgerflow
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${name}
  minReplicas: ${replicas}
  maxReplicas: ${maxReplicas}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
`
      : '';
  const keda =
    scaler === 'keda'
      ? `---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: ${name}
  namespace: ledgerflow
spec:
  scaleTargetRef:
    name: ${name}
  minReplicaCount: 1
  maxReplicaCount: 10
  cooldownPeriod: 120
  triggers:
    - type: azure-servicebus
      metadata:
        queueName: notification
        namespace: \${SERVICE_BUS_NAMESPACE}
        messageCount: "5"
      authenticationRef:
        name: workload-identity-auth
`
      : '';

  const yaml = `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${name}
  namespace: ledgerflow
  annotations:
    azure.workload.identity/client-id: \${WORKLOAD_CLIENT_ID_${envName}}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: ledgerflow
  labels:
    app: ${name}
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
        azure.workload.identity/use: "true"
    spec:
      serviceAccountName: ${name}
      terminationGracePeriodSeconds: 30
      containers:
        - name: ${name}
          image: \${ACR_LOGIN_SERVER}/ledgerflow/${name}:\${IMAGE_TAG}
          ports:
            - name: http
              containerPort: 3000
          env:
            - name: SERVICE_NAME
              value: ${name}
            - name: PORT
              value: "3000"
            - name: LEDGERFLOW_ENV
              value: \${LEDGERFLOW_ENV}
            - name: OTEL_ENABLED
              value: "true"
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: http://otel-collector.ledgerflow.svc:4317
          startupProbe:
            httpGet:
              path: /health/live
              port: http
            periodSeconds: 5
            failureThreshold: 12
          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
            periodSeconds: 10
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /health/live
              port: http
            periodSeconds: 15
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 5"]
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              memory: 512Mi
---
apiVersion: v1
kind: Service
metadata:
  name: ${name}
  namespace: ledgerflow
spec:
  selector:
    app: ${name}
  ports:
    - name: http
      port: 80
      targetPort: http
${pdb}${hpa}${keda}`;
  writeFileSync(join(dir.pathname, `${name}.yaml`), yaml);
}

process.stdout.write(`wrote ${services.length} workloads\n`);
