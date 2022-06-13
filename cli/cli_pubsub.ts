import { denoflareCliCommand, parseRequiredStringOption } from './cli_common.ts';
import { CliCommandModifier } from './cli_command.ts';
import { publish, PUBLISH_COMMAND } from './cli_pubsub_publish.ts';

export const PUBSUB_COMMAND = denoflareCliCommand('pubsub', 'Publish or subscribe to a Cloudflare Pub/Sub broker')
    .subcommand(PUBLISH_COMMAND, publish)

    .docsLink('/cli/pubsub')
    ;

export async function pubsub(args: (string | number)[], options: Record<string, unknown>): Promise<void> {
    await PUBSUB_COMMAND.routeSubcommand(args, options);
}

export function commandOptionsForPubsub(): CliCommandModifier {
    return command => command
        .optionGroup()
        .option('endpoint', 'required-string', 'MQTT endpoint') // e.g. mqtts://<broker-name>.<namespace-name>.cloudflarepubsub.com:8883
        .option('clientId', 'required-string', 'Client ID')
        .option('password', 'required-string', 'Password')
        ;
}

export function parsePubsubOptions(options: Record<string, unknown>): { endpoint: string, clientId: string, password: string } {
    const endpoint = parseRequiredStringOption('endpoint', options);
    const clientId = parseRequiredStringOption('client-id', options);
    const password = parseRequiredStringOption('password', options);
    return { endpoint, clientId, password };
}