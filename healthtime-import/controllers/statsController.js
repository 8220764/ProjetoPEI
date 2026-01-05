const { MongoClient } = require('mongodb');
const { uri, dbName } = require('../config/db');

exports.getMediaEsperaTriagem = async (req, res) => {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('emergency_records');

        const { periodo, data } = req.query;
        let startDate = new Date();
        let endDate = new Date();

        if (data) {
            startDate = new Date(data);
            endDate = new Date(data);
        }

        if (periodo === 'dia') {
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
        } else if (periodo === 'mes') {
            startDate.setDate(1);
            startDate.setHours(0, 0, 0, 0);
            endDate.setMonth(endDate.getMonth() + 1);
            endDate.setDate(0);
            endDate.setHours(23, 59, 59, 999);
        } else if (periodo === 'trimestre') {
            const currentMonth = startDate.getMonth();
            const startMonth = Math.floor(currentMonth / 3) * 3;
            startDate.setMonth(startMonth, 1);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(startDate);
            endDate.setMonth(endDate.getMonth() + 3);
            endDate.setDate(0);
            endDate.setHours(23, 59, 59, 999);
        } else {
            startDate = new Date('2000-01-01');
        }

        console.log(`A pesquisar de ${startDate.toISOString()} até ${endDate.toISOString()}`);

        const pipeline = [
            {
                $match: {
                    submission_date: { $gte: startDate, $lte: endDate }
                }
            },
            { $unwind: "$services" },
            { $unwind: "$services.triage_data" },

            // Agrupa por CÓDIGO e calcula médias
            {
                $group: {
                    _id: "$services.service_type_code",
                    nome_servico: { $first: "$services.service_name" },

                    val_muito_urgente: {
                        $avg: {
                            $cond: [{ $eq: ["$services.triage_data.color_value", "muito urgente"] }, "$services.triage_data.waiting", null]
                        }
                    },
                    val_urgente: {
                        $avg: {
                            $cond: [{ $eq: ["$services.triage_data.color_value", "urgente"] }, "$services.triage_data.waiting", null]
                        }
                    },
                    val_pouco_urgente: {
                        $avg: {
                            $cond: [{ $eq: ["$services.triage_data.color_value", "pouco urgente"] }, "$services.triage_data.waiting", null]
                        }
                    },
                    val_nao_urgente: {
                        $avg: {
                            $cond: [{ $eq: ["$services.triage_data.color_value", "nao urgente"] }, "$services.triage_data.waiting", null]
                        }
                    },
                    total_registos: { $sum: 1 }
                }
            },

            {
                $project: {
                    _id: 0,
                    codigo: "$_id",
                    servico: "$nome_servico",
                    medias_espera: {
                        "muito urgente": { $round: [{ $ifNull: ["$val_muito_urgente", 0] }, 1] },
                        "urgente":       { $round: [{ $ifNull: ["$val_urgente", 0] }, 1] },
                        "pouco urgente": { $round: [{ $ifNull: ["$val_pouco_urgente", 0] }, 1] },
                        "nao urgente":   { $round: [{ $ifNull: ["$val_nao_urgente", 0] }, 1] }
                    },
                    total_entradas_analisadas: "$total_registos"
                }
            },

            { $sort: { codigo: 1 } }
        ];

        const results = await collection.aggregate(pipeline).toArray();

        res.status(200).json({
            periodo_analisado: { inicio: startDate, fim: endDate },
            resultados: results
        });

    } catch (error) {
        console.error("Erro na estatística:", error);
        res.status(500).json({ message: "Erro ao calcular estatísticas." });
    } finally {
        await client.close();
    }
};


exports.getPercentagemTriagem = async (req, res) => {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('emergency_records');

        const { periodo, data, hospital } = req.query;
        let startDate = new Date();
        let endDate = new Date();

        if (data) {
            startDate = new Date(data);
            endDate = new Date(data);
        }

        if (periodo === 'dia') {
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
        } else if (periodo === 'mes') {
            startDate.setDate(1); startDate.setHours(0, 0, 0, 0);
            endDate.setMonth(endDate.getMonth() + 1); endDate.setDate(0); endDate.setHours(23, 59, 59, 999);
        } else {
            // Se não especificar período, busca TUDO
            startDate = new Date('2000-01-01');
            endDate = new Date('2100-01-01');
        }

        console.log(`Query: ${startDate.toISOString()} até ${endDate.toISOString()}`);
        if (hospital) console.log(`Filtro Hospital ID: ${hospital}`);

        const pipeline = [
            {
                $match: {
                    submission_date: { $gte: startDate, $lte: endDate },
                    ...(hospital ? { hospital_id: parseInt(hospital) } : {})
                }
            },
            {
                $lookup: {
                    from: "hospitals",
                    localField: "hospital_id",
                    foreignField: "hospital_id",
                    as: "hospital_info"
                }
            },
            // Se o hospital não existir na coleção 'hospitals', mantém o registo de urgência
            {
                $unwind: {
                    path: "$hospital_info",
                    preserveNullAndEmptyArrays: true
                }
            },
            { $addFields: { hour: { $hour: "$submission_date" } } },
            {
                $addFields: {
                    period: {
                        $switch: {
                            branches: [
                                { case: { $and: [{ $gte: ["$hour", 8] }, { $lt: ["$hour", 12] }] }, then: "Manha" },
                                { case: { $and: [{ $gte: ["$hour", 12] }, { $lt: ["$hour", 19] }] }, then: "Tarde" }
                            ],
                            default: "Noite"
                        }
                    },
                    // Fallback para o nome se o lookup falhar
                    nome_hospital_final: { $ifNull: ["$hospital_info.name", { $concat: ["Hospital ID ", { $toString: "$hospital_id" }] }] }
                }
            },
            { $unwind: "$services" },
            { $unwind: "$services.triage_data" },

            {
                $group: {
                    _id: {
                        Hospital: "$nome_hospital_final",
                        Period: "$period"
                    },
                    totalPatients: { $sum: "$services.triage_data.waiting" },

                    // Contagens por cor
                    sumNonUrgent: { $sum: { $cond: [{ $eq: ["$services.triage_data.color_value", "nao urgente"] }, "$services.triage_data.waiting", 0] } },
                    sumLessUrgent: { $sum: { $cond: [{ $eq: ["$services.triage_data.color_value", "pouco urgente"] }, "$services.triage_data.waiting", 0] } },
                    sumUrgent: { $sum: { $cond: [{ $eq: ["$services.triage_data.color_value", "urgente"] }, "$services.triage_data.waiting", 0] } },
                    sumVeryUrgent: { $sum: { $cond: [{ $eq: ["$services.triage_data.color_value", "muito urgente"] }, "$services.triage_data.waiting", 0] } }
                }
            },
            {
                $project: {
                    _id: 0,
                    Hospital: "$_id.Hospital",
                    Period: "$_id.Period",
                    TotalPatients: "$totalPatients",
                    Percentages: {
                        NonUrgent: {
                            $cond: [ { $eq: ["$totalPatients", 0] }, 0,
                                { $round: [{ $multiply: [{ $divide: ["$sumNonUrgent", "$totalPatients"] }, 100] }, 1] }
                            ]
                        },
                        LessUrgent: {
                            $cond: [ { $eq: ["$totalPatients", 0] }, 0,
                                { $round: [{ $multiply: [{ $divide: ["$sumLessUrgent", "$totalPatients"] }, 100] }, 1] }
                            ]
                        },
                        Urgent: {
                            $cond: [ { $eq: ["$totalPatients", 0] }, 0,
                                { $round: [{ $multiply: [{ $divide: ["$sumUrgent", "$totalPatients"] }, 100] }, 1] }
                            ]
                        },
                        VeryUrgent: {
                            $cond: [ { $eq: ["$totalPatients", 0] }, 0,
                                { $round: [{ $multiply: [{ $divide: ["$sumVeryUrgent", "$totalPatients"] }, 100] }, 1] }
                            ]
                        }
                    }
                }
            },
            { $sort: { Hospital: 1, Period: 1 } }
        ];

        const stats = await collection.aggregate(pipeline).toArray();
        const totalGlobal = stats.reduce((acc, item) => acc + item.TotalPatients, 0);

        res.json({
            period: { start: startDate, end: endDate },
            totalPatientsAnalyzed: totalGlobal,
            results: stats
        });

    } catch (error) {
        console.error("Erro:", error);
        res.status(500).json({ error: error.message });
    } finally {
        await client.close();
    }
};

exports.getMediaPediatriaRegiao = async (req, res) => {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('emergency_records');

        const { periodo } = req.query;

        // Lista de códigos associados a "PEDIATRIA" na base de dados
        const CODIGOS_PEDIATRIA = [
            "CHUA75E4", "1", "10012", "2", "PED",
            "CHTV289C", "302000", "URG3", "URGPED"
        ];

        let startDate = new Date();
        let endDate = new Date();

        if (periodo === 'semana') {
            startDate.setDate(endDate.getDate() - 7);
        } else if (periodo === 'mes') {
            startDate.setMonth(endDate.getMonth() - 1);
        } else if (periodo === 'trimestre') {
            startDate.setMonth(endDate.getMonth() - 3);
        } else {
            console.log("A buscar histórico completo.");
            startDate = new Date('2000-01-01');
            endDate = new Date('2100-01-01');
        }

        console.log(`Pediátrica por Região: ${startDate.toISOString()} até ${endDate.toISOString()}`);

        const pipeline = [
            {
                $match: {
                    submission_date: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $lookup: {
                    from: "hospitals",
                    localField: "hospital_id",
                    foreignField: "_id",
                    as: "hospital_info"
                }
            },
            { $unwind: "$hospital_info" },
            { $unwind: "$services" },

            // Filtro pelos códigos de pediatria definidos acima
            {
                $match: {
                    "services.service_type_code": { $in: CODIGOS_PEDIATRIA }
                }
            },
            // Ignorar registos sem tempo de espera definido
            {
                $match: {
                    "services.triage_data.avg_wait_time": { $exists: true, $ne: null }
                }
            },
            { $unwind: "$services.triage_data" },

            {
                $group: {
                    _id: "$hospital_info.region",
                    media_espera_minutos: { $avg: "$services.triage_data.avg_wait_time" },
                    total_hospitais: { $addToSet: "$hospital_info.name" }
                }
            },
            {
                $project: {
                    _id: 0,
                    regiao: "$_id",
                    media_espera: { $round: ["$media_espera_minutos", 1] },
                    qtd_hospitais: { $size: "$total_hospitais" }
                }
            },
            { $sort: { media_espera: -1 } }
        ];

        const results = await collection.aggregate(pipeline).toArray();

        res.status(200).json({
            periodo: periodo || "tudo",
            codigos_utilizados: CODIGOS_PEDIATRIA,
            total_resultados: results.length,
            resultados: results
        });

    } catch (error) {
        console.error("Erro Pediatria:", error);
        res.status(500).json({ message: "Erro estatística pediatria." });
    } finally {
        await client.close();
    }
};

exports.getDiferencaOncoNaoOnco = async (req, res) => {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('surgery_records');

        const month = req.query.month || "Dezembro";
        const year = parseInt(req.query.year) || 2024;
        const especialidade = req.query.specialty || req.query.especialidade;

        if (!especialidade) {
            return res.status(400).json({
                error: "Falta a especialidade! Use '?specialty=Ortopedia' ou '?especialidade=Ginecologia'"
            });
        }

        console.log(`Comparação Onco vs Não-Onco: ${month}/${year} para '${especialidade}'...`);

        const pipeline = [
            {
                $match: {
                    "reference_period.month": month,
                    "reference_period.year": year
                }
            },
            {
                $lookup: {
                    from: "hospitals",
                    localField: "hospital_id",
                    foreignField: "hospital_id",
                    as: "hospital_info"
                }
            },
            { $unwind: { path: "$hospital_info", preserveNullAndEmptyArrays: true } },

            { $unwind: "$services" },

            {
                $match: {
                    "services.specialty_name": { $regex: new RegExp(especialidade.trim(), "i") }
                }
            },

            {
                $group: {
                    _id: { $ifNull: ["$hospital_info.name", "$hospital_name"] },
                    Speciality: { $first: "$services.specialty_name" },

                    // Médias de espera (dias)
                    avgWaitOnco: { $avg: "$services.avg_wait_days.oncological" },
                    avgWaitNonOnco: { $avg: "$services.avg_wait_days.non_oncological" },

                    totalOnco: { $sum: "$services.wait_list.oncological" },
                    totalNonOnco: { $sum: "$services.wait_list.non_oncological" }
                }
            },

            {
                $project: {
                    _id: 0,
                    Hospital: "$_id",
                    Speciality: "$Speciality",

                    WaitDays_Onco: { $round: [{ $ifNull: ["$avgWaitOnco", 0] }, 1] },
                    WaitDays_NonOnco: { $round: [{ $ifNull: ["$avgWaitNonOnco", 0] }, 1] },

                    // Diferença: (Não-Onco - Onco)
                    // Se positivo, Não-Onco esperam mais. Se negativo, Onco esperam mais.
                    Difference: {
                        $round: [
                            { $subtract: [
                                    { $ifNull: ["$avgWaitNonOnco", 0] },
                                    { $ifNull: ["$avgWaitOnco", 0] }
                                ]},
                            1
                        ]
                    },

                    TotalPatients_Onco: "$totalOnco",
                    TotalPatients_NonOnco: "$totalNonOnco"
                }
            },

            // Ordenar pela maior disparidade
            { $sort: { Difference: -1 } }
        ];

        const stats = await collection.aggregate(pipeline).toArray();

        res.json({
            period: { month, year },
            specialty_filter: especialidade,
            count: stats.length,
            results: stats
        });

    } catch (error) {
        console.error("Erro Comparação Onco:", error);
        res.status(500).json({ error: error.message });
    } finally {
        await client.close();
    }
};


exports.getComparacaoCirurgiaGeralOnco = async (req, res) => {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('surgery_records');

        const month = req.query.month || "Outubro";
        const year = parseInt(req.query.year) || 2024;
        const especialidade = req.query.specialty;

        console.log(`Comparação Geral vs Onco: ${month}/${year}`);

        let pipeline = [
            {
                $match: {
                    "reference_period.month": month,
                    "reference_period.year": year
                }
            },
            { $unwind: "$services" },

            ...(especialidade ? [{
                $match: { "services.specialty_name": new RegExp(especialidade, 'i') }
            }] : []),

            {
                $group: {
                    _id: "$services.specialty_name",

                    // Cálculo Ponderado (Dias * Nº Doentes)
                    weightedSumGeneral: {
                        $sum: { $multiply: ["$services.avg_wait_days.non_oncological", "$services.wait_list.non_oncological"] }
                    },
                    weightedSumOnco: {
                        $sum: { $multiply: ["$services.avg_wait_days.oncological", "$services.wait_list.oncological"] }
                    },

                    // Totais de Doentes (Pesos)
                    totalGeneral: { $sum: "$services.wait_list.non_oncological" },
                    totalOnco: { $sum: "$services.wait_list.oncological" }
                }
            },
            {
                $project: {
                    Speciality: "$_id",
                    _id: 0,

                    // Média Ponderada Geral (evita divisão por 0)
                    AvgWaitGeneral: {
                        $cond: [
                            { $eq: ["$totalGeneral", 0] },
                            0,
                            { $round: [{ $divide: ["$weightedSumGeneral", "$totalGeneral"] }, 1] }
                        ]
                    },
                    // Média ponderada oncológica
                    AvgWaitOncological: {
                        $cond: [
                            { $eq: ["$totalOnco", 0] },
                            0,
                            { $round: [{ $divide: ["$weightedSumOnco", "$totalOnco"] }, 1] }
                        ]
                    },

                    VolumeGeneral: "$totalGeneral",
                    VolumeOncological: "$totalOnco"
                }
            },
            { $sort: { AvgWaitGeneral: -1 } }
        ];

        const stats = await collection.aggregate(pipeline).toArray();

        res.json({
            filter: { month, year, specialty: especialidade || "Todas" },
            count: stats.length,
            results: stats
        });

    } catch (error) {
        console.error("Erro Query 5:", error);
        res.status(500).json({ error: error.message });
    } finally {
        await client.close();
    }
};


exports.getDiscrepanciaConsultaCirurgia = async (req, res) => {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('consultation_records');

        const month = req.query.month || "Fevereiro";
        const year = parseInt(req.query.year) || 2025;

        console.log(`Procurando Consultas de ${month}/${year}...`);

        const pipeline = [
            {
                $match: {
                    "reference_period.month": { $regex: new RegExp(`^${month}$`, 'i') },
                    "reference_period.year": year
                }
            },
            { $unwind: "$specialties" },

            // Join com Cirurgias
            {
                $lookup: {
                    from: "surgery_records",
                    let: {
                        h_id: "$hospital_id",
                        spec_name: "$specialties.specialty_name",
                        month_ref: "$reference_period.month",
                        year_ref: "$reference_period.year"
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$hospital_id", "$$h_id"] },
                                        { $eq: ["$reference_period.year", "$$year_ref"] },
                                        { $eq: ["$reference_period.month", "$$month_ref"] }
                                    ]
                                }
                            }
                        },
                        { $unwind: "$services" },
                        {
                            $match: {
                                $expr: { $eq: ["$services.specialty_name", "$$spec_name"] }
                            }
                        }
                    ],
                    as: "cirurgia_match"
                }
            },

            // Preservar dados mesmo que o Join falhe
            {
                $unwind: {
                    path: "$cirurgia_match",
                    preserveNullAndEmptyArrays: true
                }
            },

            {
                $project: {
                    _id: 0,
                    Hospital: "$hospital_name",
                    Especialidade: "$specialties.specialty_name",

                    DiasEspera_Consulta: { $round: ["$specialties.avg_wait_days.normal", 1] },

                    DiasEspera_Cirurgia: { $ifNull: [{ $round: ["$cirurgia_match.services.avg_wait_days.non_oncological", 1] }, "NÃO ENCONTRADO"] },

                    Status: {
                        $cond: [
                            { $ifNull: ["$cirurgia_match", false] },
                            "Sucesso (Match)",
                            "Falha (Cirurgia não encontrada)"
                        ]
                    }
                }
            },
            { $sort: { Hospital: 1, Especialidade: 1 } }
        ];

        const stats = await collection.aggregate(pipeline).toArray();

        if (stats.length === 0) {
            console.log("AVISO: Não foram encontradas NENHUMAS consultas para a data indicada.");
        }

        res.json({
            filter: { month, year },
            count: stats.length,
            results: stats
        });

    } catch (error) {
        console.error("Erro Discrepância:", error);
        res.status(500).json({ error: error.message });
    } finally {
        await client.close();
    }
};


exports.getTopHospitaisPediatria = async (req, res) => {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('emergency_records');

        const { periodo, data } = req.query;

        let startDate = new Date();
        let endDate = new Date();

        if (data) {
            startDate = new Date(data);
            endDate = new Date(data);
        }

        if (periodo === 'dia') {
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
        } else if (periodo === 'semana') {
            const day = startDate.getDay();
            const diff = startDate.getDate() - day + (day === 0 ? -6 : 1);
            startDate.setDate(diff);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6);
            endDate.setHours(23, 59, 59, 999);
        } else if (periodo === 'mes') {
            startDate.setDate(1);
            startDate.setHours(0, 0, 0, 0);
            endDate.setMonth(endDate.getMonth() + 1);
            endDate.setDate(0);
            endDate.setHours(23, 59, 59, 999);
        } else {
            startDate = new Date('2000-01-01');
            endDate = new Date('2100-01-01');
        }

        console.log(`Top 10 Melhores Hospitais Pediatria (${periodo || 'tudo'})`);

        const pipeline = [
            {
                $match: {
                    submission_date: { $gte: startDate, $lte: endDate }
                }
            },
            { $unwind: "$services" },
            {
                $match: {
                    "services.service_name": { $regex: /pedi|child|criança/i }
                }
            },
            { $unwind: "$services.triage_data" },
            {
                $group: {
                    _id: "$hospital_id",
                    media_espera: { $avg: "$services.triage_data.avg_wait_time" }
                }
            },
            {
                $lookup: {
                    from: "hospitals",
                    localField: "_id",
                    foreignField: "_id",
                    as: "info_hospital"
                }
            },
            { $unwind: "$info_hospital" },
            { $sort: { media_espera: 1 } },
            { $limit: 10 },
            {
                $project: {
                    _id: 0,
                    hospital: "$info_hospital.name",
                    regiao: "$info_hospital.region",
                    contacto: "$info_hospital.contacts.phone",
                    tempo_medio_minutos: { $round: ["$media_espera", 1] }
                }
            }
        ];

        const results = await collection.aggregate(pipeline).toArray();

        res.status(200).json({
            ranking: "Top 10 Hospitais com menor espera em Urgência Pediátrica",
            periodo: periodo || "tudo",
            resultados: results
        });

    } catch (error) {
        console.error("Erro Top Pediatria:", error);
        res.status(500).json({ message: "Erro ao calcular top pediatria." });
    } finally {
        await client.close();
    }
};
exports.getEvolucaoTemporal = async (req, res) => {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('emergency_records');

        const { data, hospital } = req.query;

        let targetDate = new Date();
        if (data) {
            targetDate = new Date(data);
        }

        const startDate = new Date(targetDate);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(targetDate);
        endDate.setHours(23, 59, 59, 999);

        console.log(`Evolução 15min para: ${startDate.toLocaleDateString()}`);

        const pipeline = [
            {
                $match: {
                    submission_date: { $gte: startDate, $lte: endDate }
                }
            },

            ...(hospital ? [{ $match: { hospital_name: { $regex: hospital, $options: 'i' } } }] : []),

            { $unwind: "$services" },

            {
                $match: {
                    "services.service_name": { $regex: /geral/i }
                }
            },

            { $unwind: "$services.triage_data" },

            {
                $project: {
                    hora: { $hour: "$submission_date" },
                    minuto: { $minute: "$submission_date" },
                    tempo_espera: "$services.triage_data.avg_wait_time"
                }
            },
            // Converter tudo para minutos totais (ex: 01:30 = 90 min)
            {
                $project: {
                    tempo_espera: 1,
                    minutos_totais: { $add: [{ $multiply: ["$hora", 60] }, "$minuto"] }
                }
            },
            // Arredondar para o bloco de 15 min inferior (Floor)
            {
                $project: {
                    tempo_espera: 1,
                    bucket_minutos: {
                        $multiply: [
                            { $floor: { $divide: ["$minutos_totais", 15] } },
                            15
                        ]
                    }
                }
            },

            {
                $group: {
                    _id: "$bucket_minutos",
                    media_espera: { $avg: "$tempo_espera" },
                    total_registos: { $sum: 1 }
                }
            },

            // Formatar a hora para leitura humana (ex: "14:15")
            {
                $project: {
                    _id: 0,
                    minutos_do_dia: "$_id",
                    hora_formatada: {
                        $concat: [
                            { $toString: { $floor: { $divide: ["$_id", 60] } } },
                            ":",
                            {
                                $cond: [
                                    { $lt: [{ $mod: ["$_id", 60] }, 10] },
                                    { $concat: ["0", { $toString: { $mod: ["$_id", 60] } }] },
                                    { $toString: { $mod: ["$_id", 60] } }
                                ]
                            }
                        ]
                    },
                    tempo_medio: { $round: ["$media_espera", 1] }
                }
            },

            {
                $facet: {
                    // Lista A: Ordenada por tempo (para o gráfico)
                    "linha_temporal": [
                        { $sort: { minutos_do_dia: 1 } }
                    ],
                    // Lista B: Ordenada por espera (para o Top 3)
                    "picos_afluencia": [
                        { $sort: { tempo_medio: -1 } },
                        { $limit: 3 }
                    ]
                }
            }
        ];

        const results = await collection.aggregate(pipeline).toArray();

        res.status(200).json(results[0]);

    } catch (error) {
        console.error("Erro Evolução:", error);
        res.status(500).json({ message: "Erro ao calcular evolução temporal." });
    } finally {
        await client.close();
    }
};

exports.getHospitais = async (req, res) => {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);
        
        // Filtro opcional: ?region=Norte
        const query = req.query.region ? { region: req.query.region } : {};

        const hospitals = await db.collection('hospitals').find(query).toArray();

        res.status(200).json(hospitals);
    } catch (error) {
        console.error("Erro ao buscar hospitais:", error);
        res.status(500).json({ error: "Erro ao buscar hospitais." });
    } finally {
        await client.close();
    }
};

// === 1. GET SERVICES (Tabela de Serviços) ===
exports.getServices = async (req, res) => {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);
        
        // Verifica se queres filtrar por tipo ou trazer tudo
        const query = {}; 
        
        const results = await db.collection('services') // Confirma se a coleção se chama 'services'
            .find(query)
            .limit(100) // Limite de segurança
            .toArray();

        res.status(200).json(results);
    } catch (error) {
        console.error("Erro services:", error);
        res.status(500).json({ error: "Erro ao buscar serviços." });
    } finally {
        await client.close();
    }
};

// === 2. GET SURGERY (Cirurgias) ===
exports.getSurgeries = async (req, res) => {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);

        const limit = parseInt(req.query.limit) || 50;

        const results = await db.collection('surgery_records') // Confirma se é 'surgery' ou 'surgeries'
            .find({})
            .sort({ _id: -1 }) // Mais recentes primeiro (assumindo _id sequencial ou timestamp)
            .limit(limit)
            .toArray();

        res.status(200).json({ total: results.length, dados: results });
    } catch (error) {
        console.error("Erro cirurgias:", error);
        res.status(500).json({ error: "Erro ao buscar cirurgias." });
    } finally {
        await client.close();
    }
};

// === 3. GET EMERGENCY RECORDS (Registos de Urgência) ===
// (Esta substitui ou melhora a que fizemos antes)
exports.getEmergencyRecords = async (req, res) => {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);

        const limit = parseInt(req.query.limit) || 50;

        const results = await db.collection('emergency_records')
            .find({})
            .sort({ submission_date: -1 }) // Ordenar por data (mais recente primeiro)
            .limit(limit)
            .toArray();

        res.status(200).json({ total: results.length, dados: results });
    } catch (error) {
        console.error("Erro urgencias:", error);
        res.status(500).json({ error: "Erro ao buscar registos de urgência." });
    } finally {
        await client.close();
    }
};

// === 4. GET CONSULTATION RECORDS (Registos de Consultas) ===
exports.getConsultations = async (req, res) => {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);

        const limit = parseInt(req.query.limit) || 50;

        const results = await db.collection('consultation_records')
            .find({})
            .sort({ _id: -1 }) 
            .limit(limit)
            .toArray();

        res.status(200).json({ total: results.length, dados: results });
    } catch (error) {
        console.error("Erro consultas:", error);
        res.status(500).json({ error: "Erro ao buscar consultas." });
    } finally {
        await client.close();
    }
};