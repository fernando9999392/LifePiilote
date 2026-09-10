const express=require("express");
const OpenAI=require("openai");
require("dotenv").config();
const app=express();
app.use(express.json());
app.use(express.static("public"));
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
let state={tasks:[],events:[],goals:[]};

const tools=[
 {type:"function",name:"create_task",description:"Cria uma tarefa no LifePilote.",parameters:{type:"object",properties:{text:{type:"string"},priority:{type:"string",enum:["alta","media","baixa"]}},required:["text"]}},
 {type:"function",name:"complete_task",description:"Conclui uma tarefa existente.",parameters:{type:"object",properties:{text:{type:"string"}},required:["text"]}},
 {type:"function",name:"create_event",description:"Cria um compromisso na agenda.",parameters:{type:"object",properties:{title:{type:"string"},datetime:{type:"string",description:"Data e hora em ISO 8601"}},required:["title","datetime"]}},
 {type:"function",name:"create_goal",description:"Cria um objetivo.",parameters:{type:"object",properties:{text:{type:"string"}},required:["text"]}},
 {type:"function",name:"list_tasks",description:"Lista as tarefas atuais.",parameters:{type:"object",properties:{},additionalProperties:false}},
 {type:"function",name:"list_events",description:"Lista os compromissos atuais.",parameters:{type:"object",properties:{},additionalProperties:false}},
 {type:"function",name:"list_goals",description:"Lista os objetivos atuais.",parameters:{type:"object",properties:{},additionalProperties:false}}
];

function callTool(name,args){
 if(name==="create_task"){state.tasks.push({id:Date.now(),text:args.text,priority:args.priority||"media",done:false});return state.tasks.at(-1)}
 if(name==="complete_task"){let t=state.tasks.find(x=>x.text.toLowerCase().includes(args.text.toLowerCase()));if(t)t.done=true;return t||{error:"Tarefa não encontrada"}}
 if(name==="create_event"){let e={id:Date.now(),title:args.title,datetime:args.datetime};state.events.push(e);return e}
 if(name==="create_goal"){let g={id:Date.now(),text:args.text};state.goals.push(g);return g}
 if(name==="list_tasks")return state.tasks;
 if(name==="list_events")return state.events;
 if(name==="list_goals")return state.goals;
}

app.post("/api/chat",async(req,res)=>{
 try{
  let input=req.body.message;
  let response=await client.responses.create({
   model:"gpt-5.6-luna",
   instructions:`Você é o LifePilote, um assistente pessoal inteligente. Responda em português do Brasil, com clareza e naturalidade. Você pode usar ferramentas para agir na agenda, tarefas e objetivos. Não diga que fez algo se a ferramenta não confirmar. Quando faltar informação essencial para criar um evento, pergunte. A IA é online e depende de internet.`,
   input,
   tools
  });
  while(response.output.some(x=>x.type==="function_call")){
   const calls=response.output.filter(x=>x.type==="function_call");
   const outputs=calls.map(c=>({type:"function_call_output",call_id:c.call_id,output:JSON.stringify(callTool(c.name,JSON.parse(c.arguments||"{}")))}));
   response=await client.responses.create({model:"gpt-5.6-luna",previous_response_id:response.id,input:outputs,tools});
  }
  res.json({reply:response.output_text,state});
 }catch(e){console.error(e);res.status(500).json({error:"Falha ao falar com a IA."})}
});
app.get("/api/state",(req,res)=>res.json(state));
app.listen(process.env.PORT||3000,()=>console.log("LifePilote online na porta "+(process.env.PORT||3000)));
