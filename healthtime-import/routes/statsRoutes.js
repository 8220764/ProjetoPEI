const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');

// Rota: GET /api/stats/urgencia/media-espera
// Params: ?periodo=dia|mes|trimestre&data=YYYY-MM-DD
router.get('/urgencia/media-espera', statsController.getMediaEsperaTriagem);
router.get('/urgencia/percentagem-triagem', statsController.getPercentagemTriagem);
router.get('/urgencia/pediatria-regional', statsController.getMediaPediatriaRegiao);
router.get('/cirurgias/diferenca-onco', statsController.getDiferencaOncoNaoOnco);
router.get('/cirurgias/comparacao-geral-onco', statsController.getComparacaoCirurgiaGeralOnco);
router.get('/discrepancia/consulta-cirurgia', statsController.getDiscrepanciaConsultaCirurgia);
router.get('/urgencia/top-pediatria', statsController.getTopHospitaisPediatria);
router.get('/urgencia/evolucao-temporal', statsController.getEvolucaoTemporal);
router.get('/hospitais', statsController.getHospitais);
router.get('/servicos', statsController.getServices);
router.get('/cirurgias', statsController.getSurgeries);
router.get('/registos-urgencia', statsController.getEmergencyRecords);
router.get('/consultas', statsController.getConsultations);

module.exports = router;