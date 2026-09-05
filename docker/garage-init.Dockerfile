# A shell plus the real Garage CLI, for the one-off cluster setup in docker-compose.s3.yml.
#
# The upstream dxflrs/garage image is distroless — it contains `/garage` and nothing else,
# not even /bin/sh. That is the right call for a long-running daemon and useless for an
# init step that has to branch on what already exists. So: Garage's own binary, lifted
# unchanged onto a base that can run a script.
#
# Nothing is compiled and nothing is patched. The binary is byte-for-byte the one from the
# published image, which is what makes this safe to do rather than a supply-chain smell.

FROM dxflrs/garage:v2.3.0 AS garage

FROM alpine:3.22
COPY --from=garage /garage /usr/local/bin/garage
COPY garage-init.sh /usr/local/bin/garage-init
RUN chmod +x /usr/local/bin/garage-init
ENTRYPOINT ["/bin/sh", "/usr/local/bin/garage-init"]
