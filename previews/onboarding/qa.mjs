const frame=document.getElementById('preview');
document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.size){const [width,height]=button.dataset.size.split(',');frame.width=width;frame.height=height;}else if(button.id==='reload')frame.src='./';});
