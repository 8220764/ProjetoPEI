const express = require('express');
const router = express.Router();
const importController = require('../controllers/importController');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

console.log("Ficheiro de Rotas carregado com sucesso!");

// 1. Hospitais
router.post('/hospitais', upload.single('file'), importController.importHospitals);

// 2. Consultas
router.post('/consultas', upload.single('file'), importController.importConsultas);

// 3. Cirurgias
router.post('/cirurgias', upload.single('file'), importController.importCirurgias);

// 4. Urgências
router.post('/urgencia', upload.single('file'), importController.importUrgencia);

// 5. Serviços
router.post('/servicos', upload.single('file'), importController.importServicosXML);

module.exports = router;