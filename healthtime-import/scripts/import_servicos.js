const fs = require('fs');
const csv = require('csv-parser');
const { MongoClient } = require('mongodb');
const path = require('path');

// Configuração
const uri = "mongodb://localhost:27017";
const dbName = "HealthTimeDB";

const filesPath = path.join(__dirname, '../../dados/');

async function importServices() {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log("Ligado ao MongoDB (Serviços)");

        const db = client.db(dbName);
        const collection = db.collection('services');
        const bulkOperations = [];
        let rowCount = 0;

        const csvFile = path.join(filesPath, 'Servicos.csv');

        if (!fs.existsSync(csvFile)) {
            throw new Error(`Ficheiro não encontrado: ${csvFile}`);
        }

        await new Promise((resolve, reject) => {
            fs.createReadStream(csvFile)
                .pipe(csv({
                    separator: ',',
                    mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim()
                }))
                .on('data', (row) => {
                    rowCount++;

                    if (row.ServiceKey) {
                        const id = parseInt(row.ServiceKey);

                        if (!isNaN(id)) {
                            // Lógica Type Code
                            let typeDesc = (row.TypeDescription || '').toLowerCase();
                            let typeCode = 'desconhecido';

                            if (typeDesc.includes('surgery') || typeDesc.includes('cirurgia')) {
                                typeCode = 'cirurgia';
                            } else if (typeDesc.includes('appointment') || typeDesc.includes('consulta')) {
                                typeCode = 'consulta';
                            }

                            // Lógica de Prioridade e Descrição
                            let rawPriority = parseInt(row.PriorityCode);
                            let finalPriorityCode = 1; // Predefinição (Normal)
                            let priorityDescription = "Normal";

                            if (isNaN(rawPriority) || rawPriority === 0 || rawPriority === 1) {
                                finalPriorityCode = 1;
                                priorityDescription = "Normal";
                            } else if (rawPriority === 2) {
                                finalPriorityCode = 2;
                                priorityDescription = "Prioritário";
                            } else if (rawPriority === 3) {
                                finalPriorityCode = 3;
                                priorityDescription = "Muito Prioritário";
                            }

                            // Lógica Oncológica
                            const isOncological = (finalPriorityCode === 3);

                            const serviceDoc = {
                                _id: id,
                                service_key: id,
                                name: row.Speciality || row.Service,
                                type_code: typeCode,
                                priority_code: finalPriorityCode,
                                priority_description: priorityDescription,
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
                    }
                })
                .on('end', () => resolve())
                .on('error', (error) => reject(error));
        });

        if (bulkOperations.length > 0) {
            const result = await collection.bulkWrite(bulkOperations);
            console.log(`Processo concluído!`);
            console.log(`   - Linhas lidas: ${rowCount}`);
            console.log(`   - Documentos Inseridos/Atualizados: ${result.upsertedCount + result.modifiedCount}`);
        } else {
            console.log("AVISO: Nenhum dado válido encontrado para importar.");
        }

    } catch (err) {
        console.error("Erro na importação:", err.message);
    } finally {
        await client.close();
    }
}

importServices();