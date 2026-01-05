// HEALTHTIME API - Ponto de Entrada (Entry Point)
const express = require('express');
const cors = require('cors');

// 1. IMPORTAR AS ROTAS (As "gavetas" que organizámos)
const importRoutes = require('./routes/importRoutes');
const statsRoutes = require('./routes/statsRoutes');

const app = express();
const port = 3000;

// 2. MIDDLEWARES GLOBAIS
app.use(cors());              // Permite que o Dashboard aceda à API
app.use(express.json());      // Permite que a API entenda dados em formato JSON
app.use('/api/stats', statsRoutes);

// 3. LIGAÇÃO DOS MÓDULOS DE ROTAS
// Todas as rotas de submissão XML começam com /api (ex: /api/urgencia)
app.use('/api/import', importRoutes);

// Todas as rotas de relatórios começam com /api/relatorios (ex: /api/relatorios/top10)
app.use('/api/relatorios', statsRoutes);

// 4. ARRANQUE DO SERVIDOR
app.listen(port, () => {
    console.log(`HealthTime API a funcionar na porta ${port}`);
});