const fs = require('fs');
const xml2js = require('xml2js');
const { MongoClient } = require('mongodb');
const { uri, dbName } = require('../config/db');
const { ensureArray } = require('../utils/xmlHelper');

const parser = new xml2js.Parser({ explicitArray: false });

const triageColorMap = {
    'Blue': 'nao urgente',
    'Green': 'pouco urgente',
    'Yellow': 'urgente',
    'Red': 'muito urgente'
};

exports.importHospitals = async (req, res) => {
    if (!req.file) return res.status(400).send("Erro: Falta ficheiro.");
    const client = new MongoClient(uri);

    try {
        const xmlContent = fs.readFileSync(req.file.path);
        const result = await parser.parseStringPromise(xmlContent);

        // Valida estrutura XML
        if (!result.HospitalsData || !result.HospitalsData.Hospital) {
            throw new Error("XML inválido: Tag <HospitalsData> ou <Hospital> em falta.");
        }

        const hospitalsList = ensureArray(result.HospitalsData.Hospital);
        const bulkOps = [];

        await client.connect();
        const hospitalsCollection = client.db(dbName).collection('hospitals');

        // Lógica de ID manual: busca o último para incrementar
        const lastDoc = await hospitalsCollection.find().sort({ _id: -1 }).limit(1).toArray();
        let currentIdCounter = (lastDoc.length > 0) ? lastDoc[0]._id + 1 : 1;

        for (const hosp of hospitalsList) {
            const name = hosp.Name;
            if (!name) continue;

            const existing = await hospitalsCollection.findOne({ name: name });
            let hospitalId;

            if (existing) {
                hospitalId = existing._id;
            } else {
                hospitalId = currentIdCounter++;
            }

            const doc = {
                _id: hospitalId,
                hospital_id: hospitalId,
                name: hosp.Name,
                region: hosp.Region,
                address: {
                    street: hosp.Address?.Street,
                    city: hosp.Address?.City
                },
                contacts: {
                    phone: hosp.Contacts?.Phone,
                    email: hosp.Contacts?.Email
                },
                coordinates: {
                    lat: parseFloat(hosp.Coordinates?.Latitude || 0),
                    lon: parseFloat(hosp.Coordinates?.Longitude || 0)
                },
                created_at: existing ? existing.created_at : new Date(),
                last_updated: new Date()
            };

            bulkOps.push({
                updateOne: {
                    filter: { _id: hospitalId },
                    update: { $set: doc },
                    upsert: true
                }
            });
        }

        if (bulkOps.length > 0) {
            await hospitalsCollection.bulkWrite(bulkOps);
        }

        fs.unlinkSync(req.file.path);
        res.status(200).json({
            message: "Lista de hospitais importada com sucesso.",
            total_processed: bulkOps.length,
            note: "Os IDs foram gerados ou mantidos automaticamente."
        });

    } catch (error) {
        console.error(error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).send(error.message);
    } finally {
        await client.close();
    }
};

exports.importConsultas = async (req, res) => {
    if (!req.file) return res.status(400).send("Erro: Falta ficheiro.");
    const client = new MongoClient(uri);

    try {
        const xmlContent = fs.readFileSync(req.file.path);
        const result = await parser.parseStringPromise(xmlContent);

        const root = result.ConsultationReport;
        const hospitalId = parseInt(root.Header.HospitalId);

        await client.connect();
        const db = client.db(dbName);

        // Validação de existência do Hospital
        const hospitalDoc = await db.collection('hospitals').findOne({ _id: hospitalId });

        if (!hospitalDoc) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({
                message: `Erro: Hospital ID ${hospitalId} não encontrado. Registe o hospital primeiro via 'importHospitals'.`
            });
        }

        const realHospitalName = hospitalDoc.name;
        const xmlSpecialties = ensureArray(root.Specialties.SpecialtyEntry);
        const collection = db.collection('consultation_records');

        const existingDoc = await collection.findOne({ hospital_id: hospitalId });
        let finalSpecialties = existingDoc ? existingDoc.specialties : [];

        xmlSpecialties.forEach(xmlSpec => {
            const newServiceKey = parseInt(xmlSpec.ServiceKey);
            const newName = xmlSpec.Name;

            const existingIndex = finalSpecialties.findIndex(s =>
                (s.service_key && s.service_key === newServiceKey) ||
                s.specialty_name === newName
            );

            const newNonOnco = parseInt(xmlSpec.WaitListCounts.NonOncological) || 0;
            const newOnco = parseInt(xmlSpec.WaitListCounts.Oncological) || 0;
            const newGeneral = newNonOnco + newOnco;

            if (existingIndex > -1) {
                // Merge com dados existentes
                finalSpecialties[existingIndex].wait_list.general += newGeneral;
                finalSpecialties[existingIndex].wait_list.non_oncological += newNonOnco;
                finalSpecialties[existingIndex].wait_list.oncological += newOnco;

                finalSpecialties[existingIndex].avg_wait_days = {
                    normal: parseFloat(xmlSpec.AverageWaitTimeDays.Normal),
                    priority: parseFloat(xmlSpec.AverageWaitTimeDays.Priority),
                    very_priority: parseFloat(xmlSpec.AverageWaitTimeDays.VeryPriority)
                };
                if (newServiceKey) finalSpecialties[existingIndex].service_key = newServiceKey;

            } else {
                // Novo registo
                finalSpecialties.push({
                    service_key: newServiceKey,
                    specialty_name: newName,
                    target_population: xmlSpec.TargetPopulation,
                    wait_list: {
                        general: newGeneral,
                        non_oncological: newNonOnco,
                        oncological: newOnco
                    },
                    avg_wait_days: {
                        normal: parseFloat(xmlSpec.AverageWaitTimeDays.Normal),
                        priority: parseFloat(xmlSpec.AverageWaitTimeDays.Priority),
                        very_priority: parseFloat(xmlSpec.AverageWaitTimeDays.VeryPriority)
                    }
                });
            }
        });

        await collection.updateOne(
            { hospital_id: hospitalId },
            {
                $set: {
                    hospital_id: hospitalId,
                    hospital_name: realHospitalName,
                    last_updated: new Date(),
                    reference_period: {
                        year: parseInt(root.Header.ReferencePeriod.Year),
                        month: root.Header.ReferencePeriod.Month
                    },
                    specialties: finalSpecialties
                }
            },
            { upsert: true }
        );

        fs.unlinkSync(req.file.path);
        res.status(200).json({ message: "Consultas importadas com sucesso." });

    } catch (error) {
        console.error(error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).send(error.message);
    } finally {
        await client.close();
    }
};

exports.importCirurgias = async (req, res) => {
    if (!req.file) return res.status(400).send("Erro: Falta ficheiro.");
    const client = new MongoClient(uri);

    try {
        const xmlContent = fs.readFileSync(req.file.path);
        const result = await parser.parseStringPromise(xmlContent);

        const root = result.SurgeryReport;
        const hospitalId = parseInt(root.Header.HospitalId);

        await client.connect();
        const db = client.db(dbName);

        const hospitalDoc = await db.collection('hospitals').findOne({ _id: hospitalId });

        if (!hospitalDoc) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({
                message: `Erro: Hospital ID ${hospitalId} não encontrado. Registe o hospital primeiro via 'importHospitals'.`
            });
        }

        const realHospitalName = hospitalDoc.name;
        const collection = db.collection('surgery_records');

        const xmlSurgeries = ensureArray(root.Surgeries.SurgeryEntry);

        const existingDoc = await collection.findOne({ hospital_id: hospitalId });
        let finalServices = existingDoc ? existingDoc.services : [];

        xmlSurgeries.forEach(xmlSurg => {
            const newName = xmlSurg.SpecialtyName;
            const existingIndex = finalServices.findIndex(s => s.specialty_name === newName);

            const newNonOnco = parseInt(xmlSurg.WaitListCounts.NonOncological) || 0;
            const newOnco = parseInt(xmlSurg.WaitListCounts.Oncological) || 0;
            const newGeneral = newNonOnco + newOnco;

            if (existingIndex > -1) {
                finalServices[existingIndex].wait_list.general += newGeneral;
                finalServices[existingIndex].wait_list.non_oncological += newNonOnco;
                finalServices[existingIndex].wait_list.oncological += newOnco;

                finalServices[existingIndex].avg_wait_days = {
                    non_oncological: parseFloat(xmlSurg.AverageWaitTimeDays.NonOncological || 0),
                    oncological: parseFloat(xmlSurg.AverageWaitTimeDays.Oncological || 0)
                };
            } else {
                finalServices.push({
                    specialty_name: newName,
                    wait_list: {
                        general: newGeneral,
                        non_oncological: newNonOnco,
                        oncological: newOnco
                    },
                    avg_wait_days: {
                        non_oncological: parseFloat(xmlSurg.AverageWaitTimeDays.NonOncological || 0),
                        oncological: parseFloat(xmlSurg.AverageWaitTimeDays.Oncological || 0)
                    }
                });
            }
        });

        await collection.updateOne(
            { hospital_id: hospitalId },
            {
                $set: {
                    hospital_id: hospitalId,
                    hospital_name: realHospitalName,
                    last_updated: new Date(),
                    reference_period: {
                        year: parseInt(root.Header.ReferencePeriod.Year),
                        month: root.Header.ReferencePeriod.Month
                    },
                    services: finalServices
                }
            },
            { upsert: true }
        );

        fs.unlinkSync(req.file.path);
        res.status(200).json({ message: "Cirurgias importadas com sucesso." });

    } catch (error) {
        console.error(error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).send(error.message);
    } finally {
        await client.close();
    }
};

exports.importUrgencia = async (req, res) => {
    if (!req.file) return res.status(400).send("Erro: Falta ficheiro.");
    const client = new MongoClient(uri);

    try {
        const xmlContent = fs.readFileSync(req.file.path);
        const result = await parser.parseStringPromise(xmlContent);

        const root = result.EmergencyReport;
        const hospitalId = parseInt(root.Header.HospitalId);

        const servicesList = ensureArray(root.Services.Service);

        const emergencyServices = servicesList.map(svc => ({
            service_type_code: svc.Type.$.code,
            service_name: svc.Type._ || svc.Type,
            status: svc.Status,
            triage_data: ensureArray(svc.Triage.Level).map(level => ({
                color_original: level.$.color,
                color_value: triageColorMap[level.$.color] || 'desconhecido',
                waiting: parseInt(level.WaitingCount),
                observing: parseInt(level.UnderObservationCount),
                avg_wait_time: parseInt(level.AverageWaitTimeMinutes)
            }))
        }));

        const recordToSave = {
            hospital_id: hospitalId,
            submission_date: new Date(root.Header.SubmissionTime),
            services: emergencyServices
        };

        await client.connect();
        await client.db(dbName).collection('emergency_records').insertOne(recordToSave);

        fs.unlinkSync(req.file.path);
        res.status(200).json({ message: "Urgencia recebida com sucesso." });
    } catch (error) {
        console.error(error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).send(error.message);
    } finally {
        await client.close();
    }
};

exports.importServicosXML = async (req, res) => {
    if (!req.file) return res.status(400).send("Erro: Falta ficheiro.");
    const client = new MongoClient(uri);

    try {
        const xmlContent = fs.readFileSync(req.file.path);
        const result = await parser.parseStringPromise(xmlContent);

        if (!result.ServicesReport || !result.ServicesReport.Services) {
            throw new Error("XML inválido: Tags ServicesReport ou Services em falta.");
        }

        const servicesList = ensureArray(result.ServicesReport.Services.ServiceEntry);
        const bulkOperations = [];

        servicesList.forEach(svc => {
            const id = parseInt(svc.Code);
            if (!isNaN(id)) {
                let typeStr = (svc.Type || '').toLowerCase();
                let typeCode = 'desconhecido';
                if (typeStr.includes('cirurgia')) typeCode = 'cirurgia';
                else if (typeStr.includes('consulta')) typeCode = 'consulta';

                // Lógica de Prioridade (1: Normal, 2: Prioritário, 3: Muito Prioritário)
                let rawPriority = parseInt(svc.PriorityCode);
                let finalPriorityCode = 1;
                let priorityDesc = "Normal";

                if (isNaN(rawPriority) || rawPriority <= 1) {
                    finalPriorityCode = 1;
                    priorityDesc = "Normal";
                } else if (rawPriority === 2) {
                    finalPriorityCode = 2;
                    priorityDesc = "Prioritário";
                } else if (rawPriority === 3) {
                    finalPriorityCode = 3;
                    priorityDesc = "Muito Prioritário";
                }

                const isOncological = (finalPriorityCode === 3);

                const serviceDoc = {
                    _id: id,
                    service_key: id,
                    name: svc.Description,
                    type_code: typeCode,
                    priority_code: finalPriorityCode,
                    priority_description: priorityDesc,
                    is_oncological: isOncological,
                    last_updated: new Date()
                };

                bulkOperations.push({
                    updateOne: {
                        filter: { _id: id },
                        update: { $set: serviceDoc },
                        upsert: true
                    }
                });
            }
        });

        await client.connect();
        if (bulkOperations.length > 0) {
            await client.db(dbName).collection('services').bulkWrite(bulkOperations);
        }

        fs.unlinkSync(req.file.path);
        res.status(200).json({
            message: "Serviços processados com sucesso via XML.",
            total_processed: bulkOperations.length
        });

    } catch (error) {
        console.error(error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).send(error.message);
    } finally {
        await client.close();
    }
};