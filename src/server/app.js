import express from 'express';
import bodyParser from 'body-parser';
import apiRoutes from '../api/routes.js';
import { logHttpRequest, logWarn, logInfo, logError } from '../logger/index.js';
import { getServiceMetadata, SERVICE_NAME } from '../utils/branding.js';
import { getProviderState } from '../cli/menu.js';

export function createServer() {
    const app = express();

    app.use(logHttpRequest);
    app.use(bodyParser.json({ limit: '150mb' }));
    app.use(bodyParser.urlencoded({ limit: '150mb', extended: true }));

    app.use((err, req, res, next) => {
        const isJsonSyntaxError =
            err instanceof SyntaxError &&
            err.status === 400 &&
            Object.prototype.hasOwnProperty.call(err, 'body');

        if (isJsonSyntaxError) {
            logWarn(`Invalid JSON request body: ${err.message}`);
            return res.status(400).json({
                error: 'invalid_json',
                message: 'Request body must be valid JSON.'
            });
        }

        return next(err);
    });

    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        if (req.method === 'OPTIONS') return res.sendStatus(200);
        next();
    });

    app.use('/api', apiRoutes);
    app.use('/v1', apiRoutes);

    app.get('/', (req, res) => {
        res.json({
            ...getServiceMetadata(),
            ok: true,
            mode: 'multi-provider',
            baseUrl: '/api',
            providers: getProviderState(),
            endpoints: {
                health: '/healthz',
                apiHealth: '/api/health',
                models: '/api/models',
                chatCompletions: '/api/chat/completions',
                activeProvider: '/api/providers/active',
                authModes: '/api/providers/auth-modes',
                zaiStatus: '/api/providers/zai/status',
                deepseekStatus: '/api/providers/deepseek/status',
                kimiStatus: '/api/providers/kimi/status',
                minimaxStatus: '/api/providers/minimax/status'
            }
        });
    });

    app.get('/healthz', (req, res) => {
        res.json({
            ...getServiceMetadata(),
            ok: true,
            mode: 'multi-provider',
            providers: getProviderState(),
            timestamp: new Date().toISOString()
        });
    });

    app.use((req, res) => {
        logWarn(`404 Not Found: ${req.method} ${req.originalUrl}`);
        res.status(404).json({
            error: 'not_found',
            message: 'Endpoint not found.'
        });
    });

    app.use((err, req, res, next) => {
        logError('Unhandled server error', err);
        res.status(500).json({
            error: 'server_error',
            message: 'Internal server error.'
        });
    });

    return app;
}

export function startHttpServer(app, host, port) {
    return new Promise((resolve, reject) => {
        const server = app.listen(port, host);

        server.once('listening', () => {
            const displayHost = host === '0.0.0.0' ? 'localhost' : host;
            logInfo(`${SERVICE_NAME} is listening on ${host}:${port}`);
            logInfo('Models endpoint: GET /api/models');
            logInfo('Chat endpoint: POST /api/chat/completions');
            logInfo('Provider status: GET /healthz, GET /api/providers/zai/status, GET /api/providers/deepseek/status');
            
            const baseUrl = `http://${displayHost}:${port}/api`;
            const labelStr = '✨ USE THIS BASE URL FOR YOUR AGENTS / CLIENTS:';
            
            console.log('\n\x1b[36m' + '╭' + '─'.repeat(86) + '╮\x1b[0m');
            console.log('\x1b[36m│\x1b[0m   \x1b[1m' + labelStr.padEnd(82) + '\x1b[0m\x1b[36m│\x1b[0m');
            console.log('\x1b[36m│\x1b[0m   \x1b[1m\x1b[32m' + baseUrl.padEnd(83) + '\x1b[0m\x1b[36m│\x1b[0m');
            console.log('\x1b[36m' + '╰' + '─'.repeat(86) + '╯\x1b[0m\n');

            resolve(server);
        });

        server.once('error', reject);
    });
}
