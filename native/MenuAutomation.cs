using System.Runtime.InteropServices;

// Use the Windows accessibility provider for menus whose mouse handlers read
// GetCursorPos. This never injects a physical mouse movement or clicks a window
// underneath a menu that disappeared between mouse-down and mouse-up.
static class MenuAutomation {
    [ThreadStatic] static IAutomation? automation;
    public static int Actions { get; private set; }
    public static bool At(int x,int y,bool invoke=false,bool expandOnly=false) {
        var references=new List<object>();
        try {
            automation??=(IAutomation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("ff48dba4-60ef-4201-aa87-54103eef594e"),true)!)!;
            automation.ElementFromPoint(new IndependentPointer.POINT{X=x,Y=y},out var element);if(element==null)return false;references.Add(element);
            automation.RawViewWalker(out var walker);if(walker==null)return false;references.Add(walker);
            IElement? candidate=null;bool menu=false;
            for(int depth=0;depth<8&&element!=null;depth++){
                element.GetCurrentPropertyValue(30003,out var typeValue);int type=Convert.ToInt32(typeValue);
                if(candidate==null&&type is 50000 or 50011)candidate=element;
                if(type is 50009 or 50010 or 50011){menu=true;break;}
                walker.GetParentElement(element,out var parent);element=parent;if(parent!=null)references.Add(parent);
            }
            if(!menu||candidate==null)return false;
            if(!invoke&&!expandOnly)return true;
            candidate.GetCurrentPropertyValue(30010,out var enabled);if(enabled is not true)return true;
            if(TryPattern(candidate,10005,out var expand)){
                references.Add(expand);var pattern=(IExpand)expand;pattern.CurrentState(out var state);
                if(state!=3){if(state==0||state==2)pattern.Expand();Actions++;return true;}
            }
            if(expandOnly)return true;
            if(!TryPattern(candidate,10000,out var action))return false;
            references.Add(action);((IInvoke)action).Invoke();Actions++;return true;
        }catch(COMException){return false;}catch(InvalidCastException){return false;}catch(ArgumentException){return false;}
        finally {foreach(var value in references.Distinct(ReferenceEqualityComparer.Instance).Reverse())if(Marshal.IsComObject(value))Marshal.ReleaseComObject(value);}
    }
    static bool TryPattern(IElement element,int id,out object pattern){try{element.GetCurrentPattern(id,out pattern);return pattern!=null;}catch(COMException){pattern=null!;return false;}}

    // Vtable order follows Microsoft's UIAutomationClient.h. Only the methods
    // called here are marshalled; the intervening slots remain placeholders.
    [ComImport,Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAutomation {
        void CompareElements();void CompareRuntimeIds();void GetRootElement();void ElementFromHandle();
        void ElementFromPoint(IndependentPointer.POINT point,out IElement element);
        void GetFocusedElement();void GetRootElementBuildCache();void ElementFromHandleBuildCache();void ElementFromPointBuildCache();void GetFocusedElementBuildCache();void CreateTreeWalker();void ControlViewWalker();void ContentViewWalker();
        void RawViewWalker(out IWalker walker);
    }
    [ComImport,Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IElement {
        void SetFocus();void GetRuntimeId();void FindFirst();void FindAll();void FindFirstBuildCache();void FindAllBuildCache();void BuildUpdatedCache();
        void GetCurrentPropertyValue(int id,[MarshalAs(UnmanagedType.Struct)]out object value);
        void GetCurrentPropertyValueEx();void GetCachedPropertyValue();void GetCachedPropertyValueEx();void GetCurrentPatternAs();void GetCachedPatternAs();
        void GetCurrentPattern(int id,[MarshalAs(UnmanagedType.IUnknown)]out object pattern);
    }
    [ComImport,Guid("4042c624-389c-4afc-a630-9df854a541fc"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IWalker {void GetParentElement(IElement element,out IElement parent);}
    [ComImport,Guid("fb377fbe-8ea6-46d5-9c73-6499642d3059"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IInvoke {void Invoke();}
    [ComImport,Guid("619be086-1f4e-4ee4-bafa-210128738730"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IExpand {void Expand();void Collapse();void CurrentState(out int state);}
}
