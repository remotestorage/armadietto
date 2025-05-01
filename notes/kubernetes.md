# Installing Armadietto on a Kubernetes cluster

Kubernetes configuration and administration is a complex field.
This note outlines, for developers, aspects of one approach to installing Armadietto on a running cluster.
If someone else is administering your Kubernetes cluster, send them this and ask them what resources you'll need to add to the cluster.
They will probably have you skip steps II–III and modify step IV.

## I. Install `kubectl` and `helm` on your development computer

These tools allow you to administer Kubernetes clusters.

1. See [(Kubernetes) Install Tools](https://kubernetes.io/docs/tasks/tools/).
    If you have Docker Desktop installed, `kubectl` is already installed.

2. Configure `kubectl` to talk to your cluster.
   If you have Docker Desktop installed and Kubernetes activated, `kubectl` is already configured to talk to the local cluster. Otherwise, see the documentation for your provider.

3. See [Installing Helm](https://helm.sh/docs/intro/install/)

## II. Install Cert-manager and create ClusterIssuers

Cert-manager obtains a new TLS (SSL) certificate, when needed, for each Ingress on your cluster.
A ClusterIssuer resource tells Cert-manager how to negotiate with the issuer.
The [sample ClusterIssuers](../contrib/kubernetes/cert-manager-clusterissuer.yaml) use Let's Encrypt, which is free.
They live in the namespace `cert-manager`.

1. See [cert-manager Installation](https://cert-manager.io/docs/installation/).

2. Edit the file [cert-manager-clusterissuser.yaml](../contrib/kubernetes/cert-manager-clusterissuer.yaml) to set your email address.

3. Run `kub apply -f cert-manager-clusterissuer.yaml` to create staging and production ClusterIssuers.

4. Run `kub get clusterissuer` and verify that both ClusterIssuers are ready.

## III. Install HAProxy Ingress Controller on your cluster

This manages connections into the cluster for any number of hostnames and applications, via a single load balancer.
It handles TLS (SSL) so Armadietto can be accessed over HTTPS but doesn't have to directly deal with certificates.
It lives in the namespace `haproxy-controller`.

1. Edit the file [haproxy-values.yaml](../contrib/kubernetes/haproxy-values.yaml) as needed.

2. run `helm upgrade --install haproxy-controller haproxytech/kubernetes-ingress --create-namespace --namespace haproxy-controller -f haproxy-values.yaml`

3. [optional] Run `helm get manifest haproxy-controller -n haproxy-controller > armadietto-get-manifest.yaml` to record the configuration, for debugging.

4. [optional] If the configuration is not what you need, return to step 1.

## IV. Install Armadietto in the `storage` namespace.

1. Edit the [armadietto template file](../contrib/kubernetes/armadietto.yaml).
    1. It is crucial that you set `trust_proxy` to the actual address range of nodes in your Kubernetes cluster, or Armadietto will be unable to set secure cookies, and thus sessions won't work.
    2. Replace every instance of `storage.example.com` with your hostname.
    3. Set `S3_ENDPOINT`, `S3_ACCESS_KEY` and `S3_SECRET_KEY` (and `S3_REGION` if necessary) to point to your S3-compatible storage.
    4. Set `BOOTSTRAP_OWNER` to correspond to an administrator account.
    5. Set both instances of `secretName` to a name related to Armadietto and/or your hostname.

2. Run `kubectl apply -f armadietto.yaml` to create the Kubernetes resources.
3. Run `kubectl rollout status deploy armadietto` to follow the progress of deployment.

## V. Open the HTTPS port in the firewall

... if it isn't open.
