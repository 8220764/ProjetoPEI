const fs = require('fs');
const csv = require('csv-parser');
const { MongoClient } = require('mongodb');
const path = require('path');

// Configurações
const uri = "mongodb://localhost:27017";
const dbName = "HealthTimeDB";
const filesPath = path.join(__dirname, '../../dados/');

async function importConsultasOnly() {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log("Ligado ao MongoDB");
        const db = client.db(dbName);

        // 1. Carregar Catálogo de Serviços
        console.log("A carregar catálogo de serviços...");
        const servicesCollection = db.collection('services');
        const allServices = await servicesCollection.find({}).toArray();

        const serviceMap = new Map();
        const serviceNames = new Map();

        allServices.forEach(svc => {
            const tipo = (svc.type_code || svc.type || '').toLowerCase();
            serviceMap.set(svc._id, tipo);
            serviceNames.set(svc._id, svc.name || svc.specialty);
        });

        // 2. Ler CSV e filtrar Consultas
        const groupedData = {};
        const csvFile = path.join(filesPath, 'TemposEsperaConsultaCirurgia.csv');

        console.log("A ler CSV e filtrar Consultas...");

        await new Promise((resolve, reject) => {
            fs.createReadStream(csvFile)
                .pipe(csv({ separator: ',', mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim() }))
                .on('data', (row) => {
                    const serviceId = parseInt(row.ServiceKey || row.ServiceSK);
                    const hospitalName = row.HospitalName || row.Institution;

                    if (serviceId && serviceMap.has(serviceId) && hospitalName) {
                        const tipoServico = serviceMap.get(serviceId);

                        if (tipoServico.includes('consulta') || tipoServico.includes('appointment')) {

                            if (!groupedData[hospitalName]) groupedData[hospitalName] = [];

                            groupedData[hospitalName].push({
                                service_key: serviceId,
                                specialty_name: serviceNames.get(serviceId),
                                count: parseInt(row.NumberOfPeople) || 0,
                                days: parseFloat((row.AverageWaitingTime_Speciality_Priority_Institution || '0').replace(',', '.')) || 0
                            });
                        }
                    }
                })
                .on('end', () => resolve())
                .on('error', (err) => reject(err));
        });

        // 3. Atualizar Base de Dados
        const collection = db.collection('consultation_records');
        const hospitals = Object.keys(groupedData);
        console.log(`A processar ${hospitals.length} hospitais com dados de consultas...`);

        for (const hospitalName of hospitals) {
            const newItems = groupedData[hospitalName];

            const existingDoc = await collection.findOne({ hospital_name: hospitalName });
            let finalSpecialties = existingDoc ? existingDoc.specialties : [];
            if (!finalSpecialties) finalSpecialties = [];

            for (const item of newItems) {
                const index = finalSpecialties.findIndex(s =>
                    (s.service_key === item.service_key) || (s.specialty_name === item.specialty_name)
                );

                if (index > -1) {
                    if (!finalSpecialties[index].wait_list) finalSpecialties[index].wait_list = { general: 0, non_oncological: 0, oncological: 0 };

                    finalSpecialties[index].wait_list.general += item.count;
                    finalSpecialties[index].wait_list.non_oncological += item.count;

                    if (!finalSpecialties[index].avg_wait_days) finalSpecialties[index].avg_wait_days = {};
                    finalSpecialties[index].avg_wait_days.normal = item.days;
                } else {
                    finalSpecialties.push({
                        service_key: item.service_key,
                        specialty_name: item.specialty_name,
                        target_population: "Geral",
                        wait_list: { general: item.count, non_oncological: item.count, oncological: 0 },
                        avg_wait_days: { normal: item.days, priority: 0, very_priority: 0 }
                    });
                }
            }

            await collection.updateOne(
                { hospital_name: hospitalName },
                {
                    $set: {
                        hospital_name: hospitalName,
                        last_updated: new Date(),
                        specialties: finalSpecialties
                    }
                },
                { upsert: true }
            );
        }

        console.log("Importação de Consultas concluída!");

    } catch (err) {
        console.error("Erro:", err.message);
    } finally {
        await client.close();
    }
}

importConsultasOnly();